import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { mapEstadoAlPlan } from "@/lib/otEstado";
import { reconciliarTurnosGuardia } from "@/lib/planificacion/reconciliarTurnosGuardia";

type BitacoraEntry = { turno: string; supervisor: string; nota: string; hhAtendidas: number; fecha?: string };

type OtProgramadaRow = Record<string, unknown> & {
  id: string; numeroOT: string; estado: string; ordenTrabajoId: string | null; ordenTrabajoNum: string | null;
};

// OTs que JDE sigue reportando semana tras semana (trabajos que se extienden
// más de una semana) ya tienen una OrdenTrabajo abierta con su propio
// historial. Si el plan de una semana quedó publicado sin enlazarla (p. ej.
// se publicó antes de que existiera, o antes de este fix), Registro las
// muestra como "no iniciada" aunque el técnico ya viene registrando avances.
// Se reconcilia en cada lectura para que se autocorrija sin acción manual.
//
// También cubre el caso recurrente: cuando un técnico registra el avance de
// UN día de una OT recurrente, el backend (api/ordenes POST) solo enlaza esa
// fila puntual — los demás días de la semana quedan "en_proceso" (estado por
// defecto al publicar el plan) pero sin ordenTrabajoId. Registro los toma
// como huérfanos y cae al "hermano registrado" (refRegistradaMap), que si
// quedó en "completada" bloquea la semana entera. Por eso aquí no se filtra
// solo "no_iniciada": cualquier fila sin ordenTrabajoId que aún no esté
// completada/en revisión es candidata a enlazarse con la OT abierta.
//
// OTs de largo aliento (misma OT JDE reprogramada semana tras semana, p. ej.
// 949186): el ciclo de revisión semanal (pendiente_revision → revisado →
// concluido) deja la OrdenTrabajo maestra bloqueada para el técnico apenas el
// supervisor cierra el reporte de esa semana. Antes esto exigía que un admin
// la reabriera a mano cada lunes ("Reabrir OT"). Ahora, si vuelve a aparecer
// una fila de plan programada para el mismo otJdeNumero, se reabre sola —
// salvo que se haya marcado cerradaDefinitiva (la OT no va a continuar).
const ESTADOS_BLOQUEAN_TECNICO = ["pendiente_revision", "revisado", "concluido"];

async function reabrirSiBloqueada(
  existente: { id: string; numeroOT: string; estado: string; otJdeNumero: string | null }
): Promise<void> {
  if (!ESTADOS_BLOQUEAN_TECNICO.includes(existente.estado)) return;
  const estadoAnterior = existente.estado;
  await prisma.ordenTrabajo.update({ where: { id: existente.id }, data: { estado: "en_proceso" } });
  await prisma.otHistorial.create({
    data: {
      ordenTrabajoId: existente.id,
      usuarioId: "system",
      nombreUsuario: "Sistema",
      cambio: `Reabierta automáticamente: OT recurrente con nueva semana programada (venía en "${estadoAnterior}")`,
    },
  });
  existente.estado = "en_proceso"; // se comparte por referencia: el resto de filas de esta OT en el mismo lote ya no reabren de nuevo
}

async function reconciliarContinuaciones(
  programas: Array<{ fechaFin: Date | string; otsProgramadas: OtProgramadaRow[] }>
): Promise<void> {
  // OtProgramada.numeroOT guarda el N° de OT del JDE (lo que se ve en la
  // tarjeta del plan), NO el numeroOT interno de OrdenTrabajo (correlativo
  // generado por siguienteNumeroOT(), único por registro). Por eso el match
  // debe hacerse contra OrdenTrabajo.otJdeNumero — comparar contra
  // OrdenTrabajo.numeroOT nunca encontraba coincidencias y esta reconciliación
  // quedaba sin efecto en la práctica para cualquier OT de origen JDE.
  const pendientes = programas
    .flatMap(p => p.otsProgramadas)
    .filter(o => !o.ordenTrabajoId && o.estado !== "completada" && o.estado !== "en_revision");

  // Filas YA enlazadas que muestran "completada"/"en_revision": si la semana
  // ya pasó, es un cierre legítimo y no se toca. Si es la semana actual o una
  // futura, ese estado solo puede venir de "Propagar al plan semanal" en
  // api/ordenes/[id]/route.ts, que al cambiar el estado de una OT recurrente
  // actualiza TODAS sus filas de OtProgramada sin distinguir semana — por eso
  // una semana que el técnico nunca tocó puede aparecer ya "cerrada". Se
  // revalida contra el estado real (ya reabierto o no) de la OT.
  const inicioSemanaActual = new Date();
  inicioSemanaActual.setUTCDate(inicioSemanaActual.getUTCDate() - ((inicioSemanaActual.getUTCDay() + 6) % 7));
  inicioSemanaActual.setUTCHours(4, 0, 0, 0);
  const vinculadasCerradas = programas
    .filter(p => new Date(p.fechaFin) >= inicioSemanaActual)
    .flatMap(p => p.otsProgramadas)
    .filter(o => !!o.ordenTrabajoId && (o.estado === "completada" || o.estado === "en_revision"));

  if (pendientes.length === 0 && vinculadasCerradas.length === 0) return;

  const numeros = [...new Set(pendientes.map(o => o.numeroOT))];
  const ids = [...new Set(vinculadasCerradas.map(o => o.ordenTrabajoId as string))];
  const existentes = await prisma.ordenTrabajo.findMany({
    where: {
      cerradaDefinitiva: false,
      OR: [
        ...(numeros.length ? [{ otJdeNumero: { in: numeros } }] : []),
        ...(ids.length ? [{ id: { in: ids } }] : []),
      ],
    },
    select: { id: true, numeroOT: true, estado: true, otJdeNumero: true },
  });
  if (existentes.length === 0) return;

  const porNumero = new Map(existentes.map(o => [o.otJdeNumero as string, o]));
  const porId = new Map(existentes.map(o => [o.id, o]));

  for (const row of pendientes) {
    const existente = porNumero.get(row.numeroOT);
    if (!existente) continue;
    await reabrirSiBloqueada(existente);

    const nuevoEstado = mapEstadoAlPlan(existente.estado);
    await prisma.otProgramada.update({
      where: { id: row.id },
      data: { ordenTrabajoId: existente.id, ordenTrabajoNum: existente.numeroOT, estado: nuevoEstado },
    });
    row.ordenTrabajoId = existente.id;
    row.ordenTrabajoNum = existente.numeroOT;
    row.estado = nuevoEstado;
  }

  for (const row of vinculadasCerradas) {
    const existente = porId.get(row.ordenTrabajoId as string);
    if (!existente) continue;
    await reabrirSiBloqueada(existente);

    const nuevoEstado = mapEstadoAlPlan(existente.estado);
    if (nuevoEstado !== row.estado) {
      await prisma.otProgramada.update({ where: { id: row.id }, data: { estado: nuevoEstado } });
      row.estado = nuevoEstado;
    }
  }
}

// Offset por día de la semana (lunes = 0)
const DIA_OFFSET: Record<string, number> = { Lu: 0, Ma: 1, Mi: 2, Ju: 3, Vi: 4, Sa: 5, Do: 6 };

function serializePrograma(
  p: Record<string, unknown> & {
    otsProgramadas?: Record<string, unknown>[];
    personal?: Record<string, unknown>[];
    resumenDias?: Record<string, unknown>[];
  },
  bitacoraMap: Record<string, BitacoraEntry[]> = {},
  hhRealesPorOrdenId: Record<string, number> = {},
  hhRegistroPorOrdenIdYFecha: Record<string, Record<string, number>> = {}
) {
  const fechaIni = p.fechaInicio instanceof Date ? p.fechaInicio : p.fechaInicio ? new Date(p.fechaInicio as string) : null;

  return {
    _id: p.id,
    semana: p.semana, anio: p.anio, disciplina: p.disciplina,
    areaCodigo: p.areaCodigo, estado: p.estado, subidoPor: p.subidoPor,
    fechaInicio: p.fechaInicio, fechaFin: p.fechaFin,
    hhDisponiblesSemana: p.hhDisponiblesSemana,
    hhProgramadasSemana: p.hhProgramadasSemana,
    hhReactivoSemana: p.hhReactivoSemana,
    otsProgramadas: (p.otsProgramadas ?? []).map((o) => {
      const isOpeplant = Boolean(o.esGuardia) || String(o.tag ?? "").includes("OPEPLANT");
      // Fecha calendario real de esta fila (lunes + offset del día) — se usa tanto
      // para la clave de bitácora OPEPLANT como para leer el avance diario de OTs
      // regulares en esa fecha exacta.
      let fechaOTStr: string | null = null;
      if (fechaIni) {
        const offset = DIA_OFFSET[String(o.dia ?? "")] ?? -1;
        if (offset >= 0) {
          fechaOTStr = new Date(fechaIni.getTime() + offset * 86400000).toISOString().slice(0, 10);
        }
      }
      // Clave exacta por OT + turno + fecha del día específico de esta fila
      let key: string | null = null;
      if (isOpeplant && fechaOTStr) {
        // o.grupo es "Diurno"/"Nocturno" para OTs OPEPLANT — coincide con rep.turno en el mapa
        const grupoUp = String(o.grupo ?? "").toUpperCase();
        key = `${String(o.numeroOT ?? "").toUpperCase()}|${grupoUp}|${fechaOTStr}`;
      }
      const registrosOT = o.ordenTrabajoId
        ? hhRegistroPorOrdenIdYFecha[o.ordenTrabajoId as string]
        : undefined;
      return {
        numeroOT: o.numeroOT, tipoOT: o.tipoOT, tipoTrabajo: o.tipoTrabajo,
        prioridad: o.prioridad, descripcion: o.descripcion, tag: o.tag,
        descripcionEquipo: o.descripcionEquipo, personas: o.personas,
        hrsTrabajo: o.hrsTrabajo, hhTotal: o.hhTotal,
        personalAsignado: o.personalAsignado, personalAsignadoIds: o.personalAsignadoIds,
        grupo: o.grupo, dia: o.dia,
        estado: o.estado, observaciones: o.observaciones,
        ordenTrabajoId: o.ordenTrabajoId, ordenTrabajoNum: o.ordenTrabajoNum,
        pasarNoche: o.pasarNoche, pasarNocheMotivo: o.pasarNocheMotivo,
        pasarNocheNota: o.pasarNocheNota, pasarNochePor: o.pasarNochePor,
        pasarNocheAt: o.pasarNocheAt, esGuardia: o.esGuardia,
        continuaMotivo: o.continuaMotivo, continuaNota: o.continuaNota,
        continuaPor: o.continuaPor, continuaAt: o.continuaAt,
        bitacora: key && bitacoraMap[key]
          ? bitacoraMap[key]
          : (Array.isArray(o.bitacora) ? o.bitacora : []),
        // HH reales, en orden de preferencia:
        // 1) bitácora de reportes de turno (OPEPLANT)
        // 2) avance diario (OtRegistroDiario) de la fecha exacta de esta fila — es la
        //    fuente que se actualiza día a día vía "+Avance del día"
        // 3) checklist (OtLinea) como fallback para OTs que no usan avance diario —
        //    ojo: esto NO varía por día, solo sirve cuando la OT no es recurrente
        //    o aún no tiene ningún registro diario
        hhReales: key && bitacoraMap[key]
          ? bitacoraMap[key].reduce((s, b) => s + (b.hhAtendidas ?? 0), 0)
          : registrosOT
            ? (fechaOTStr ? (registrosOT[fechaOTStr] ?? 0) : null)
            : (o.ordenTrabajoId && hhRealesPorOrdenId[o.ordenTrabajoId as string] !== undefined)
              ? hhRealesPorOrdenId[o.ordenTrabajoId as string]
              : null,
      };
    }),
    personal: (p.personal ?? []).map((per) => ({
      usuarioId: per.usuarioId, nombre: per.nombre, grupo: per.grupo,
      esContratista: per.esContratista, asistencia: per.asistencia,
    })),
    resumenDias: p.resumenDias ?? [],
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Fetch por id directo (usado por generarInformeOT para obtener HH del plan)
  const idParam = searchParams.get("id");
  if (idParam) {
    const programa = await prisma.programacionSemanal.findUnique({
      where: { id: idParam },
      include: { otsProgramadas: true, personal: true, resumenDias: true },
    });
    if (!programa) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await reconciliarContinuaciones([programa as unknown as { fechaFin: Date; otsProgramadas: OtProgramadaRow[] }]);
    await reconciliarTurnosGuardia([programa as unknown as Parameters<typeof reconciliarTurnosGuardia>[0][number]]);
    const { NextResponse } = await import("next/server");
    return NextResponse.json(serializePrograma(programa as Parameters<typeof serializePrograma>[0], {}, {}));
  }

  const semana     = searchParams.get("semana");
  const anio       = searchParams.get("anio");
  const disciplina = searchParams.get("disciplina");
  const estado     = searchParams.get("estado");
  const areaCodigo = searchParams.get("areaCodigo");
  const limit      = Math.min(Number(searchParams.get("limit") || "20"), 100);

  const programas = await prisma.programacionSemanal.findMany({
    where: {
      ...(semana     ? { semana: Number(semana) } : {}),
      ...(anio       ? { anio: Number(anio) }     : {}),
      ...(disciplina ? { disciplina }              : {}),
      ...(areaCodigo ? { areaCodigo }              : {}),
      ...(estado     ? { estado }                  : {}),
    },
    include: {
      otsProgramadas: searchParams.get("dia")
        ? { where: { dia: searchParams.get("dia")! } }
        : true,
      personal: true,
      resumenDias: true,
    },
    orderBy: [{ anio: "desc" }, { semana: "desc" }],
    take: limit,
  });

  await reconciliarContinuaciones(programas as unknown as { fechaFin: Date; otsProgramadas: OtProgramadaRow[] }[]);
  await reconciliarTurnosGuardia(programas as unknown as Parameters<typeof reconciliarTurnosGuardia>[0]);

  // Construir mapa de bitácora desde ReporteTurno técnicos del período
  // usando HH reales (tiempoRealHrs de sub-OTs registrados), NO el hhTotal planificado
  const allFechas = programas
    .filter(p => p.fechaInicio && p.fechaFin)
    .map(p => ({ ini: p.fechaInicio as Date, fin: p.fechaFin as Date }));

  const bitacoraMap: Record<string, BitacoraEntry[]> = {};

  if (allFechas.length) {
    const minFecha = new Date(Math.min(...allFechas.map(f => f.ini.getTime())));
    const maxFecha = new Date(Math.max(...allFechas.map(f => f.fin.getTime())));

    const reportesTecnicos = await prisma.reporteTurno.findMany({
      where: { tipo: "tecnico", fecha: { gte: minFecha, lte: maxFecha } },
      select: { id: true, turno: true, fecha: true, supervisorNombre: true, otsPlanData: true, otIds: true, createdAt: true },
      orderBy: { createdAt: "asc" }, // asc para que el más reciente sobreescriba
    });

    // Batch fetch HH reales de todos los sub-OTs registrados en estos reportes
    // También necesitamos otJdeNumero para saber a qué OPEPLANT pertenece cada sub-OT
    const allRealIds = [...new Set(
      reportesTecnicos.flatMap(r => (r.otIds as string[]).filter(id => !String(id).startsWith("plan-")))
    )];

    const hhPorOtId: Record<string, number> = {};
    const jdeNumPorOtId: Record<string, string> = {}; // subOtId -> otJdeNumero (uppercase)
    if (allRealIds.length) {
      const ordenes = await prisma.ordenTrabajo.findMany({
        where: { id: { in: allRealIds } },
        select: { id: true, otJdeNumero: true, lineas: { select: { tiempoRealHrs: true } } },
      });
      for (const ot of ordenes) {
        hhPorOtId[ot.id] = ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
        if (ot.otJdeNumero) jdeNumPorOtId[ot.id] = ot.otJdeNumero.toUpperCase();
      }
    }

    for (const rep of reportesTecnicos) {
      const turnoUp = String(rep.turno ?? "").toUpperCase();
      const fechaStr = rep.fecha.toISOString().slice(0, 10);

      // Agrupar HH por OPEPLANT padre (otJdeNumero), no sumar el total bruto del reporte
      // Cada sub-OT (CMR/CMP) tiene otJdeNumero = numeroOT del OPEPLANT padre
      const hhByJdeNum: Record<string, number> = {};
      for (const id of (rep.otIds as string[]).filter(id => !String(id).startsWith("plan-"))) {
        const jde = jdeNumPorOtId[id];
        if (jde) hhByJdeNum[jde] = (hhByJdeNum[jde] ?? 0) + (hhPorOtId[id] ?? 0);
      }

      const items = Array.isArray(rep.otsPlanData) ? rep.otsPlanData as Record<string, unknown>[] : [];
      for (const item of items) {
        const numOT = String(item.numeroOT ?? "").toUpperCase();
        if (!numOT) continue;
        // Clave idéntica al lookup en serializePrograma: numOT|TURNO|fecha
        const key = `${numOT}|${turnoUp}|${fechaStr}`;
        bitacoraMap[key] = [{
          turno: rep.turno,
          supervisor: rep.supervisorNombre ?? "",
          nota: "",
          hhAtendidas: Math.round((hhByJdeNum[numOT] ?? 0) * 10) / 10,
          fecha: fechaStr,
        }];
      }
    }
  }

  // Batch fetch HH reales de OTs regulares via ordenTrabajoId
  const allOrdenIds = [...new Set(
    programas.flatMap(p =>
      ((p.otsProgramadas ?? []) as Record<string, unknown>[])
        .map(o => o.ordenTrabajoId as string | null)
        .filter((id): id is string => !!id)
    )
  )];

  const hhRealesPorOrdenId: Record<string, number> = {};
  // ordenTrabajoId -> "YYYY-MM-DD" -> HH trabajadas registradas ese día
  const hhRegistroPorOrdenIdYFecha: Record<string, Record<string, number>> = {};
  if (allOrdenIds.length) {
    const ordenes = await prisma.ordenTrabajo.findMany({
      where: { id: { in: allOrdenIds } },
      include: {
        lineas: { select: { tiempoRealHrs: true } },
        registrosDiarios: { select: { fecha: true, hhTrabajadas: true } },
      },
    });
    for (const ot of ordenes) {
      hhRealesPorOrdenId[ot.id] = Math.round(
        ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0) * 10
      ) / 10;
      if (ot.registrosDiarios.length) {
        const porFecha: Record<string, number> = {};
        for (const r of ot.registrosDiarios) {
          const fechaStr = r.fecha.toISOString().slice(0, 10);
          porFecha[fechaStr] = Math.round(((porFecha[fechaStr] ?? 0) + (r.hhTrabajadas ?? 0)) * 10) / 10;
        }
        hhRegistroPorOrdenIdYFecha[ot.id] = porFecha;
      }
    }
  }

  return Response.json(programas.map(p => serializePrograma(
    p as Parameters<typeof serializePrograma>[0],
    bitacoraMap,
    hhRealesPorOrdenId,
    hhRegistroPorOrdenIdYFecha
  )));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { semana, anio, disciplina, areaCodigo, fechaInicio, fechaFin,
            personal, otsProgramadas, subidoPor, estado } = body;

    // Validación de borde: semana/anio/disciplina/fechas/subidoPor son NOT
    // NULL en ProgramacionSemanal sin default. Con el adaptador @prisma/adapter-pg
    // el P2011 (null constraint violation) llega sin nombre de columna
    // ("Null constraint violation on the (not available)"), así que un campo
    // faltante del body es indistinguible de cualquier otro null a simple
    // vista — mejor cortarlo acá con un mensaje que sí dice qué falta.
    const faltantes = [
      !semana ? "semana" : null,
      !anio ? "anio" : null,
      !disciplina ? "disciplina" : null,
      !fechaInicio ? "fechaInicio" : null,
      !fechaFin ? "fechaFin" : null,
    ].filter((f): f is string => f !== null);
    if (faltantes.length) {
      return Response.json(
        { ok: false, error: `Faltan campos requeridos: ${faltantes.join(", ")}` },
        { status: 400 }
      );
    }
    const subidoPorSeguro = (typeof subidoPor === "string" && subidoPor.trim()) ? subidoPor : "system";

    let hhDisponiblesSemana = 0, hhProgramadasSemana = 0, hhReactivoSemana = 0;
    const diasKeys = ["Lu","Ma","Mi","Ju","Vi","Sa","Do"] as const;

    const resumenDiasData = diasKeys.map((dia, i) => {
      const fechaDia = new Date(fechaInicio);
      fechaDia.setDate(fechaDia.getDate() + i);
      const otsDelDia = (otsProgramadas ?? []).filter((o: { dia: string }) => o.dia === dia);
      const hhProg  = otsDelDia.reduce((s: number, o: { hhTotal?: number }) => s + (o.hhTotal ?? 0), 0);
      const hhReact = otsDelDia.filter((o: { tipoOT: string }) => o.tipoOT === "C")
                               .reduce((s: number, o: { hhTotal?: number }) => s + (o.hhTotal ?? 0), 0);
      const activos = (personal ?? []).filter((p: { asistencia?: { dia: string; estado: string }[] }) =>
        p.asistencia?.some((a) => a.dia === dia && ["D","N","T"].includes(a.estado))
      ).length;
      const hhDisp = activos * 10;
      hhDisponiblesSemana += hhDisp;
      hhProgramadasSemana += hhProg;
      hhReactivoSemana    += hhReact;
      return { dia, fecha: fechaDia, hhDisponibles: hhDisp, hhProgramadas: hhProg,
               utilizacion: hhDisp > 0 ? Math.round((hhProg / hhDisp) * 100) : 0 };
    });

    // El constraint real en la BD es (semana, anio, disciplina, areaCodigo) --
    // ver @@unique en el schema. Antes solo incluía disciplina, y como
    // areaToDisciplina() mapea ~14 áreas físicas distintas (Chancado, Recursos
    // Hídricos, Flotación, Filtros, Taller General, Equipos Industriales,
    // Contratista TTMB, Molienda, Lubricación, Generación, etc) al mismo valor
    // por defecto "MEC", todas esas áreas competían por una sola fila por
    // semana: subir el programa de un área pisaba o bloqueaba el de otra área
    // completamente distinta que compartía disciplina. Al incluir areaCodigo
    // en el constraint, cada área física tiene su propia fila real.
    const existente = await prisma.programacionSemanal.findUnique({
      where: { semana_anio_disciplina_areaCodigo: { semana, anio, disciplina, areaCodigo: areaCodigo || null } },
    });
    if (existente) {
      return Response.json(
        { ok: false, error: `Ya existe un plan para semana ${semana}/${anio} en esta área. Elimínalo primero si deseas reemplazarlo.`, existenteId: existente.id },
        { status: 409 }
      );
    }

    const programa = await prisma.programacionSemanal.create({
      data: {
        semana, anio, disciplina, areaCodigo: areaCodigo || null,
        fechaInicio: new Date(fechaInicio), fechaFin: new Date(fechaFin),
        hhDisponiblesSemana, hhProgramadasSemana, hhReactivoSemana,
        estado: estado === "publicado" ? "publicado" : "borrador", subidoPor: subidoPorSeguro,
        otsProgramadas: {
          create: (otsProgramadas ?? []).map((o: Record<string, unknown>) => ({
            numeroOT: String(o.numeroOT), tipoOT: String(o.tipoOT),
            tipoTrabajo: String(o.tipoTrabajo), prioridad: (o.prioridad as string) ?? null,
            descripcion: String(o.descripcion), tag: String(o.tag).toUpperCase(),
            descripcionEquipo: (o.descripcionEquipo as string) ?? "",
            personas: Number(o.personas ?? 1), hrsTrabajo: Number(o.hrsTrabajo ?? 0),
            hhTotal: Number(o.hhTotal ?? 0),
            personalAsignado: (o.personalAsignado as string[]) ?? [],
            // La columna es NOT NULL en producción sin default real (ver
            // docker-start.sh: el ADD COLUMN ... DEFAULT solo aplica si la
            // columna no existía, y ya existía de antes sin default) — hay
            // que mandarla siempre explícita o el insert revienta.
            personalAsignadoIds: (o.personalAsignadoIds as string[]) ?? [],
            grupo: String(o.grupo), dia: String(o.dia),
            estado: (o.estado as string) ?? "no_iniciada",
            esGuardia: Boolean(o.esGuardia),
            bitacora: Array.isArray(o.bitacora) ? o.bitacora : [],
          })),
        },
        personal: {
          create: (personal ?? []).map((p: Record<string, unknown>) => ({
            usuarioId: (p.usuarioId as string) ?? null,
            nombre: String(p.nombre), grupo: String(p.grupo),
            esContratista: Boolean(p.esContratista),
            asistencia: (p.asistencia as object) ?? [],
          })),
        },
        resumenDias: { create: resumenDiasData },
      },
      include: { otsProgramadas: true, personal: true, resumenDias: true },
    });

    return Response.json(
      { ok: true, programa: serializePrograma(programa as Parameters<typeof serializePrograma>[0]) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    // code/meta de PrismaClientKnownRequestError: con el adaptador pg el P2011
    // suele llegar sin el nombre de columna en el mensaje ("(not available)"),
    // pero meta a veces sí trae algo aprovechable -- se loguea completo en
    // servidor (Railway) y se agrega al mensaje de vuelta al usuario para no
    // depender de un segundo ida-y-vuelta de deploy para diagnosticar.
    const meta = (err as { meta?: unknown })?.meta;
    const code = (err as { code?: string })?.code;
    console.error("[POST /api/programacion-semanal]", { message, code, meta });
    const detalle = meta && Object.keys(meta as object).length ? ` — ${JSON.stringify(meta)}` : "";
    return Response.json({ ok: false, error: `${message}${detalle}` }, { status: 400 });
  }
}
