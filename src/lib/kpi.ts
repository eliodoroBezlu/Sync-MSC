import { prisma } from "@/lib/prisma";
import { AreaScope, scopeWhereAreaCodigo } from "@/lib/kpiScope";
import {
  bandaCumplimiento, bandaReactivo, Semaforo,
  ESTADOS_TRABAJO_REALIZADO, TIPOS_CORRECTIVO, PARETO_TOP_N_DETALLE,
} from "@/lib/kpiConfig";

// Rango de fechas: [desde, hastaExclusiva) — mismo patrón que /api/ordenes/route.ts
// (fechaHasta se recibe inclusiva y se convierte a exclusiva sumando un día).
export type Periodo = { desde: Date; hastaExclusiva: Date };

export function periodoDia(fecha: Date): Periodo {
  const desde = new Date(fecha);
  desde.setHours(0, 0, 0, 0);
  const hastaExclusiva = new Date(desde);
  hastaExclusiva.setDate(hastaExclusiva.getDate() + 1);
  return { desde, hastaExclusiva };
}

export function periodoSemana(fechaInicio: Date, fechaFin: Date): Periodo {
  const desde = new Date(fechaInicio);
  desde.setHours(0, 0, 0, 0);
  const hastaExclusiva = new Date(fechaFin);
  hastaExclusiva.setHours(0, 0, 0, 0);
  hastaExclusiva.setDate(hastaExclusiva.getDate() + 1);
  return { desde, hastaExclusiva };
}

export type CumplimientoResult = {
  planeadas: number;
  realizadas: number;
  pct: number | null;
  semaforo: Semaforo | null;
};

export async function computeCumplimiento(scope: AreaScope, periodo: Periodo): Promise<CumplimientoResult> {
  if (!scope.allAreas && scope.areas.length === 0) {
    return { planeadas: 0, realizadas: 0, pct: null, semaforo: null };
  }
  const where = {
    origenPlan: true,
    fecha: { gte: periodo.desde, lt: periodo.hastaExclusiva },
    ...scopeWhereAreaCodigo(scope),
  };
  const [planeadas, realizadas] = await Promise.all([
    prisma.ordenTrabajo.count({ where }),
    prisma.ordenTrabajo.count({ where: { ...where, estado: { in: ESTADOS_TRABAJO_REALIZADO } } }),
  ]);
  const pct = planeadas === 0 ? null : (realizadas / planeadas) * 100;
  return { planeadas, realizadas, pct, semaforo: bandaCumplimiento(pct) };
}

export type ReactivoResult = {
  reactivoHH: number;
  totalHH: number;
  pct: number | null;
  semaforo: Semaforo | null;
};

type LineaHH = { tiempoRealHrs: number | null; tipoOT: string; tag: string; descripcionEquipo: string };
type OtConLineas = { origenPlan: boolean; parentOtId: string | null; areaCodigo: string; lineas: LineaHH[] };

async function fetchOtsConLineas(scope: AreaScope, periodo: Periodo): Promise<OtConLineas[]> {
  if (!scope.allAreas && scope.areas.length === 0) return [];
  return prisma.ordenTrabajo.findMany({
    where: {
      fecha: { gte: periodo.desde, lt: periodo.hastaExclusiva },
      ...scopeWhereAreaCodigo(scope),
    },
    select: {
      origenPlan: true,
      parentOtId: true,
      areaCodigo: true,
      lineas: { select: { tiempoRealHrs: true, tipoOT: true, tag: true, descripcionEquipo: true } },
    },
  });
}

// Una OT es reactiva/no programada solo si no tiene ningún enlace al plan: ni
// origenPlan directo, ni parentOtId hacia una OT madre planificada. Las OTs
// hijas de una madre OPEPLANT (bitácora) o de una madre enganchada por N° OT
// del programa semanal (ver /api/ordenes/route.ts) llevan origenPlan=false
// pero SÍ están dentro del programa — no deben sumar como reactivas.
function esReactiva(ot: Pick<OtConLineas, "origenPlan" | "parentOtId">): boolean {
  return !ot.origenPlan && !ot.parentOtId;
}

export async function computeReactivoHH(scope: AreaScope, periodo: Periodo): Promise<ReactivoResult> {
  const ots = await fetchOtsConLineas(scope, periodo);
  let reactivoHH = 0;
  let totalHH = 0;
  for (const ot of ots) {
    for (const linea of ot.lineas) {
      const hh = linea.tiempoRealHrs ?? 0;
      totalHH += hh;
      if (esReactiva(ot)) reactivoHH += hh;
    }
  }
  const pct = totalHH === 0 ? null : (reactivoHH / totalHH) * 100;
  return { reactivoHH, totalHH, pct, semaforo: bandaReactivo(pct) };
}

export type ParetoFila = { tag: string; descripcionEquipo: string; cantidad: number; hhTotal: number };

export async function computeParetoCorrectivas(
  scope: AreaScope,
  periodo: Periodo,
  topN: number = PARETO_TOP_N_DETALLE
): Promise<{ filas: ParetoFila[]; totalCorrectivas: number }> {
  const ots = await fetchOtsConLineas(scope, periodo);
  const porTag = new Map<string, ParetoFila>();
  let totalCorrectivas = 0;
  for (const ot of ots) {
    if (!esReactiva(ot)) continue;
    for (const linea of ot.lineas) {
      if (!TIPOS_CORRECTIVO.includes(linea.tipoOT)) continue;
      totalCorrectivas += 1;
      const existente = porTag.get(linea.tag);
      const hh = linea.tiempoRealHrs ?? 0;
      if (existente) {
        existente.cantidad += 1;
        existente.hhTotal += hh;
      } else {
        porTag.set(linea.tag, { tag: linea.tag, descripcionEquipo: linea.descripcionEquipo, cantidad: 1, hhTotal: hh });
      }
    }
  }
  const filas = Array.from(porTag.values()).sort((a, b) => b.cantidad - a.cantidad || b.hhTotal - a.hhTotal);
  return { filas: filas.slice(0, topN), totalCorrectivas };
}

export type UtilizacionArea = {
  areaCodigo: string;
  areaNombre: string;
  hhReal: number;
  hhDisponible: number | null;
  pct: number | null;
};

export async function computeUtilizacionPorArea(scope: AreaScope, periodo: Periodo, semana: number, anio: number): Promise<UtilizacionArea[]> {
  const ots = await fetchOtsConLineas(scope, periodo);
  const realPorArea = new Map<string, number>();
  for (const ot of ots) {
    const hh = ot.lineas.reduce((sum, l) => sum + (l.tiempoRealHrs ?? 0), 0);
    realPorArea.set(ot.areaCodigo, (realPorArea.get(ot.areaCodigo) ?? 0) + hh);
  }
  if (realPorArea.size === 0) return [];

  const codigos = Array.from(realPorArea.keys());
  const [areas, disponibles] = await Promise.all([
    prisma.area.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true, nombre: true } }),
    prisma.programacionSemanal.findMany({
      where: { semana, anio, areaCodigo: { in: codigos } },
      select: { areaCodigo: true, hhDisponiblesSemana: true },
    }),
  ]);
  const nombrePorCodigo = new Map(areas.map((a) => [a.codigo, a.nombre]));
  const disponiblePorCodigo = new Map<string, number>();
  for (const d of disponibles) {
    if (!d.areaCodigo) continue;
    disponiblePorCodigo.set(d.areaCodigo, (disponiblePorCodigo.get(d.areaCodigo) ?? 0) + d.hhDisponiblesSemana);
  }

  return codigos
    .map((codigo) => {
      const hhReal = realPorArea.get(codigo) ?? 0;
      const hhDisponible = disponiblePorCodigo.get(codigo) ?? null;
      const pct = hhDisponible && hhDisponible > 0 ? (hhReal / hhDisponible) * 100 : null;
      return { areaCodigo: codigo, areaNombre: nombrePorCodigo.get(codigo) ?? codigo, hhReal, hhDisponible, pct };
    })
    .sort((a, b) => b.hhReal - a.hhReal);
}

export type TendenciaPunto = { semana: number; anio: number; label: string; cumplimientoPct: number | null; reactivoPct: number | null };

export async function computeTendencia(
  scope: AreaScope,
  semanas: { semana: number; anio: number; label: string; periodo: Periodo }[]
): Promise<TendenciaPunto[]> {
  const puntos: TendenciaPunto[] = [];
  for (const s of semanas) {
    const [cumplimiento, reactivo] = await Promise.all([
      computeCumplimiento(scope, s.periodo),
      computeReactivoHH(scope, s.periodo),
    ]);
    puntos.push({ semana: s.semana, anio: s.anio, label: s.label, cumplimientoPct: cumplimiento.pct, reactivoPct: reactivo.pct });
  }
  return puntos;
}
