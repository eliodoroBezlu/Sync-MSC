// Cumplimiento del programa de calibración: programado (ProgramaCalibracion)
// vs ejecutado (RegistroCalibracion). Lógica pura, sin acceso a base de datos.
//
// Reglas:
//  - Una calibración real del mismo TAG satisface UNA fila del programa (la más
//    antigua que aún no tenga registro asignado): no se cuenta dos veces.
//  - En plazo: se calibró hasta el domingo de la semana ISO planificada
//    (incluye adelantos de hasta TOLERANCIA_ADELANTO_DIAS).
//  - Con atraso: se calibró después, antes del siguiente ciclo del TAG.
//  - Vencida: la semana planificada ya pasó y no hay calibración.
//  - Por vencer: la semana planificada aún no termina.
//  - Sin registro: vencida, pero en un período donde el sistema no tiene NINGUNA
//    calibración (datos no cargados): se excluye del KPI en vez de contarse en cero.

import {
  addDays,
  claveSemana,
  diffDays,
  finSemanaIso,
  mesDe,
  semanaIso,
  type Ymd,
} from "./fechas.ts";

export const TOLERANCIA_ADELANTO_DIAS = 14;

export type EstadoItem = "en_plazo" | "atrasada" | "vencida" | "por_vencer" | "sin_registro";
export type Vista = "mes" | "semana";

export interface ItemPrograma {
  id: string;
  tag: string;
  fechaPlan: Ymd;
  origen: string;
  programa: string;
  frecuenciaDias: number | null;
}

export interface RegistroEjecutado {
  tag: string;
  fecha: Ymd;
}

export interface ItemEvaluado extends ItemPrograma {
  estado: EstadoItem;
  fechaRealizada: Ymd | null;
  diasAtraso: number | null;
}

export interface Periodo {
  clave: string;
  etiqueta: string;
  programadas: number;
  enPlazo: number;
  atrasadas: number;
  vencidas: number;
  porVencer: number;
  sinRegistro: number;
  /** Filas que ya debían estar hechas: enPlazo + atrasadas + vencidas. */
  exigibles: number;
  /** (enPlazo + atrasadas) / exigibles, o null si nada es exigible todavía. */
  cumplimiento: number | null;
  /** enPlazo / exigibles, o null. */
  aTiempo: number | null;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function porTag<T extends { tag: string }>(filas: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const f of filas) {
    const lista = mapa.get(f.tag);
    if (lista) lista.push(f);
    else mapa.set(f.tag, [f]);
  }
  return mapa;
}

function evaluarTag(
  items: readonly ItemPrograma[],
  fechasRegistro: readonly Ymd[],
  hoy: Ymd,
): { evaluados: ItemEvaluado[]; reclamados: number } {
  const itemsOrdenados = [...items].sort((a, b) => a.fechaPlan.localeCompare(b.fechaPlan));
  const fechas = [...fechasRegistro].sort();
  const usados = new Set<number>();
  const evaluados: ItemEvaluado[] = [];

  itemsOrdenados.forEach((item, i) => {
    const desde = addDays(item.fechaPlan, -TOLERANCIA_ADELANTO_DIAS);
    // Ítems con la misma fecha (p. ej. WG y Parada) comparten ventana.
    const siguiente = itemsOrdenados.slice(i + 1).find((s) => s.fechaPlan > item.fechaPlan);
    const hasta = siguiente ? addDays(siguiente.fechaPlan, -TOLERANCIA_ADELANTO_DIAS) : null;
    const idx = fechas.findIndex(
      (f, k) => !usados.has(k) && f >= desde && (hasta === null || f < hasta),
    );
    const limite = finSemanaIso(item.fechaPlan);

    if (idx >= 0) {
      usados.add(idx);
      const realizada = fechas[idx];
      const enPlazo = realizada <= limite;
      evaluados.push({
        ...item,
        estado: enPlazo ? "en_plazo" : "atrasada",
        fechaRealizada: realizada,
        diasAtraso: enPlazo ? 0 : diffDays(realizada, limite),
      });
      return;
    }
    evaluados.push({
      ...item,
      estado: limite < hoy ? "vencida" : "por_vencer",
      fechaRealizada: null,
      diasAtraso: limite < hoy ? diffDays(hoy, limite) : null,
    });
  });

  return { evaluados, reclamados: usados.size };
}

export function evaluarPrograma(
  items: readonly ItemPrograma[],
  registros: readonly RegistroEjecutado[],
  hoy: Ymd,
): { items: ItemEvaluado[]; registrosReclamados: number } {
  const regPorTag = porTag(registros);
  const evaluados: ItemEvaluado[] = [];
  let registrosReclamados = 0;

  for (const [tag, lista] of porTag(items)) {
    const fechas = (regPorTag.get(tag) ?? []).map((r) => r.fecha);
    const res = evaluarTag(lista, fechas, hoy);
    evaluados.push(...res.evaluados);
    registrosReclamados += res.reclamados;
  }
  return { items: evaluados, registrosReclamados };
}

function claveDe(ymd: Ymd, vista: Vista): string {
  return vista === "mes" ? mesDe(ymd) : claveSemana(ymd);
}

function finDePeriodo(ymd: Ymd, vista: Vista): Ymd {
  if (vista === "semana") return finSemanaIso(ymd);
  const [y, m] = ymd.split("-").map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}

function etiquetaDe(clave: string, vista: Vista): string {
  if (vista === "semana") return `S${Number(clave.split("-W")[1])}`;
  return MESES[Number(clave.slice(5, 7)) - 1];
}

function nuevoPeriodo(clave: string, vista: Vista): Periodo {
  return {
    clave,
    etiqueta: etiquetaDe(clave, vista),
    programadas: 0,
    enPlazo: 0,
    atrasadas: 0,
    vencidas: 0,
    porVencer: 0,
    sinRegistro: 0,
    exigibles: 0,
    cumplimiento: null,
    aTiempo: null,
  };
}

function cerrarPeriodo(p: Periodo): Periodo {
  const exigibles = p.enPlazo + p.atrasadas + p.vencidas;
  return {
    ...p,
    exigibles,
    cumplimiento: exigibles > 0 ? (p.enPlazo + p.atrasadas) / exigibles : null,
    aTiempo: exigibles > 0 ? p.enPlazo / exigibles : null,
  };
}

/**
 * Agrupa las filas evaluadas por mes o por semana de su FECHA PLANIFICADA.
 * `fechasTodosRegistros` (cualquier TAG) sirve para detectar períodos sin datos cargados.
 */
export function agruparPorPeriodo(
  evaluados: readonly ItemEvaluado[],
  vista: Vista,
  fechasTodosRegistros: readonly Ymd[],
  hoy: Ymd,
): Periodo[] {
  const conDatos = new Set(fechasTodosRegistros.map((f) => claveDe(f, vista)));
  const periodos = new Map<string, Periodo>();

  for (const item of evaluados) {
    const clave = claveDe(item.fechaPlan, vista);
    const actual = periodos.get(clave) ?? nuevoPeriodo(clave, vista);
    const periodoTerminado = finDePeriodo(item.fechaPlan, vista) < hoy;
    const sinDatos = item.estado === "vencida" && periodoTerminado && !conDatos.has(clave);
    const estado: EstadoItem = sinDatos ? "sin_registro" : item.estado;

    const siguiente: Periodo = { ...actual, programadas: actual.programadas + 1 };
    if (estado === "en_plazo") siguiente.enPlazo += 1;
    else if (estado === "atrasada") siguiente.atrasadas += 1;
    else if (estado === "vencida") siguiente.vencidas += 1;
    else if (estado === "por_vencer") siguiente.porVencer += 1;
    else siguiente.sinRegistro += 1;
    periodos.set(clave, siguiente);
  }

  return [...periodos.values()].sort((a, b) => a.clave.localeCompare(b.clave)).map(cerrarPeriodo);
}

export function totalizar(periodos: readonly Periodo[]): Periodo {
  const suma = periodos.reduce<Periodo>(
    (acc, p) => ({
      ...acc,
      programadas: acc.programadas + p.programadas,
      enPlazo: acc.enPlazo + p.enPlazo,
      atrasadas: acc.atrasadas + p.atrasadas,
      vencidas: acc.vencidas + p.vencidas,
      porVencer: acc.porVencer + p.porVencer,
      sinRegistro: acc.sinRegistro + p.sinRegistro,
    }),
    { ...nuevoPeriodo("total", "mes"), etiqueta: "Total" },
  );
  return cerrarPeriodo(suma);
}

/** Año ISO de una fecha (para filtrar semanas de borde como la S1 o la S53). */
export function anioIso(ymd: Ymd): number {
  return semanaIso(ymd).anio;
}
