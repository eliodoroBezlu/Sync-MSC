import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Puente A1 — espejo de escritura Registro de OT → tablero de Parada de Planta.
//
// Cuando una OrdenTrabajo de turno "Parada de Planta" corresponde por número a
// una ParadaOt de la parada en ejecución, refleja su avance en la maquinaria de
// parada SIN repuntar el dashboard: sólo escribe.
//
//   ParadaOt.ordenTrabajoId  ← id de la OrdenTrabajo (back-link)
//   ParadaOt.estado/avancePct ← derivados del estado de la OT y sus líneas
//   ParadaAvanceDiario (paradaOtId + fecha + turno) ← upsert con las HH del día
//
// Es defensivo: cualquier fallo se registra y se ignora — el flujo de Registro
// de OT es la fuente de verdad y no debe romperse por el espejo.
// ─────────────────────────────────────────────────────────────────────────────

const TURNO_PARADA = "Parada de Planta";
const ESTADOS_OT_TERMINAL = ["pendiente_revision", "revisado", "concluido"];

// Avance físico aproximado según el estado final declarado en cada línea de la
// OT. Sin estadoFinal se asume "empezada" (10%). OT enviada a revisión → 100%.
const AVANCE_POR_ESTADO_LINEA: Record<string, number> = {
  operativo: 100,
  operativo_obs: 90,
  pendiente: 50,
  fuera_servicio: 30,
};

type LineaLike = { estadoFinal?: string | null; tiempoRealHrs?: number | null };

function avanceDesdeLineas(lineas: LineaLike[], otTerminada: boolean): number {
  if (otTerminada) return 100;
  const pcts = lineas
    .map((l) => (l.estadoFinal ? AVANCE_POR_ESTADO_LINEA[l.estadoFinal] ?? 0 : 0))
    .filter((n) => n > 0);
  if (pcts.length === 0) return 10;
  return Math.round(pcts.reduce((s, n) => s + n, 0) / pcts.length);
}

// Medianoche UTC de la fecha — mismo formato que /api/paradas/[id]/avances usa
// para la clave única (paradaOtId, fecha, turno).
function medianocheUTC(fecha: Date): Date {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

function aFecha(valor: string | Date): Date | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const s = String(valor);
  const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type EspejoParadaParams = {
  ordenTrabajoId: string;
  numeroOT: string | null | undefined;
  turno: string | null | undefined;
  estadoOT: string;
  lineas: LineaLike[];
  /** Fecha para localizar la parada en ejecución (día del turno / del avance). */
  fechaRef: string | Date;
  /** Cuando hay un registro diario real: upsert de ParadaAvanceDiario. */
  avanceDiario?: {
    fecha: string | Date;
    turnoParada: "Dia" | "Noche";
    hh: number;
    registradoPor: string;
  };
};

export async function espejarOrdenEnParada(params: EspejoParadaParams): Promise<void> {
  try {
    if (params.turno !== TURNO_PARADA || !params.numeroOT) return;

    const fechaBase = aFecha(params.fechaRef);
    if (!fechaBase) return;

    const finDia = new Date(fechaBase);
    finDia.setHours(23, 59, 59, 999);
    const iniDia = new Date(fechaBase);
    iniDia.setHours(0, 0, 0, 0);

    const parada = await prisma.parada.findFirst({
      where: {
        estado: "ejecucion",
        fechaEjecucionInicio: { lte: finDia },
        fechaEjecucionFin: { gte: iniDia },
      },
      orderBy: { fechaEjecucionInicio: "desc" },
      select: { id: true },
    });
    if (!parada) return;

    const paradaOt = await prisma.paradaOt.findFirst({
      where: { paradaId: parada.id, numeroOT: params.numeroOT, fase: "ejecucion" },
      select: { id: true, avancePct: true },
    });
    if (!paradaOt) return;

    const otTerminada = ESTADOS_OT_TERMINAL.includes(params.estadoOT);
    const avanceDerivado = avanceDesdeLineas(params.lineas, otTerminada);
    // El avance cacheado no retrocede salvo cierre explícito de la OT.
    const avancePct = otTerminada
      ? 100
      : Math.max(paradaOt.avancePct ?? 0, avanceDerivado);
    const estadoParada = otTerminada ? "terminada" : "en_ejecucion";

    await prisma.paradaOt.update({
      where: { id: paradaOt.id },
      data: {
        ordenTrabajoId: params.ordenTrabajoId,
        estado: estadoParada,
        avancePct,
      },
    });

    const av = params.avanceDiario;
    if (!av) return;
    const fechaAvance = aFecha(av.fecha);
    if (!fechaAvance) return;

    await prisma.paradaAvanceDiario.upsert({
      where: {
        paradaOtId_fecha_turno: {
          paradaOtId: paradaOt.id,
          fecha: medianocheUTC(fechaAvance),
          turno: av.turnoParada,
        },
      },
      create: {
        paradaId: parada.id,
        paradaOtId: paradaOt.id,
        fecha: medianocheUTC(fechaAvance),
        turno: av.turnoParada,
        avancePct,
        hhPropias: av.hh,
        hhApoyo: 0,
        estado: estadoParada,
        comentario: null,
        registradoPor: av.registradoPor,
      },
      update: {
        avancePct,
        hhPropias: av.hh,
        estado: estadoParada,
        registradoPor: av.registradoPor,
      },
    });
  } catch (err) {
    console.error("[puenteOt] no se pudo espejar la OT en la parada:", err);
  }
}
