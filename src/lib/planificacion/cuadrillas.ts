/**
 * Cuadrillas fijas: resolución de membresía técnico×grupo×día.
 *
 * Fuente de verdad para "quién cubre qué grupo (G1-G4|Diurno|Nocturno) qué
 * día" — desacoplada de PlanBorradorOt.dias y de PlanBorradorOt.personalAsignado
 * (que pasa a ser un cache derivado, ver cachePersonalAsignado). Un cambio de
 * técnico desde un día puntual en adelante es una edición de membresía, nunca
 * toca la OT ni el resto de la semana.
 */

export const DIAS_SEMANA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];
const DIA_INDEX: Record<string, number> = { Lu: 0, Ma: 1, Mi: 2, Ju: 3, Vi: 4, Sa: 5, Do: 6 };

export const CODIGOS_ASISTENCIA = ["D", "N", "T", "V", "CS", "L", ""] as const;
export type CodigoAsistencia = typeof CODIGOS_ASISTENCIA[number];

/** Resumen semanal (mayoría D/N) para RosterSemanal.grupo — solo display, ver CuadrillaMiembro para asignación real. */
export function calcularGrupo(asistencia: string[]): string {
  const dias = asistencia.filter(a => a === "D" || a === "N");
  if (dias.length === 0) return "Diurno";
  const nocturno = dias.filter(a => a === "N").length;
  return nocturno > dias.length / 2 ? "Nocturno" : "Diurno";
}

export interface CuadrillaMiembroRow {
  grupo: string;
  dia: string;
  tecnicoNombre: string;
  tecnicoUsuarioId: string | null;
}

export interface TecnicoRef {
  nombre: string;
  usuarioId: string | null;
}

/** Matriz completa {grupo: {dia: [técnicos]}} lista para servir por la API/UI. */
export type CuadrillaMatriz = Record<string, Record<string, TecnicoRef[]>>;

export function construirMatriz(miembros: CuadrillaMiembroRow[]): CuadrillaMatriz {
  const matriz: CuadrillaMatriz = {};
  for (const m of miembros) {
    matriz[m.grupo] ??= {};
    matriz[m.grupo][m.dia] ??= [];
    matriz[m.grupo][m.dia].push({ nombre: m.tecnicoNombre, usuarioId: m.tecnicoUsuarioId });
  }
  return matriz;
}

export function tecnicosDeCuadrillaEnDia(
  miembros: CuadrillaMiembroRow[],
  grupo: string,
  dia: string
): TecnicoRef[] {
  return miembros
    .filter(m => m.grupo === grupo && m.dia === dia)
    .map(m => ({ nombre: m.tecnicoNombre, usuarioId: m.tecnicoUsuarioId }));
}

/** Técnicos por cada día que la OT ya tiene programado, según su grupo. */
export function resolverTecnicosDeOt(
  ot: { grupo: string; dias: string[] },
  miembros: CuadrillaMiembroRow[]
): { dia: string; tecnicos: TecnicoRef[] }[] {
  return ot.dias.map(dia => ({ dia, tecnicos: tecnicosDeCuadrillaEnDia(miembros, ot.grupo, dia) }));
}

/**
 * Reconcilia el cache personalAsignado/personalAsignadoIds de una OT contra
 * la cuadrilla vigente de su grupo en los días que tiene programados.
 *
 * Filtra (nunca agrega): un técnico que ya estaba en personalAsignado se
 * mantiene solo si sigue siendo elegible (miembro de la cuadrilla del grupo
 * en al menos uno de los días de la OT); si dejó de serlo — cambió de turno,
 * lo sacaron de la cuadrilla — se cae del cache automáticamente. Esto es lo
 * que corrige el bug de "grupo estático": el cache siempre refleja membresía
 * real, nunca un valor que quedó obsoleto.
 *
 * A propósito NO vuelca aquí toda la cuadrilla elegible: para Diurno/Nocturno
 * el pool elegible puede ser todo el turno (decenas de técnicos), mientras
 * que cada OT solo necesita ~personas técnicos. Quién se agrega es decisión
 * del balanceador (candidatos filtrados por esta misma cuadrilla, ver
 * balanceador.ts) o de una asignación manual explícita — nunca un efecto
 * secundario de editar la cuadrilla.
 */
export function cachePersonalAsignado(
  ot: { grupo: string; dias: string[]; personalAsignado: string[]; personalAsignadoIds: string[] },
  miembros: CuadrillaMiembroRow[]
): { personalAsignado: string[]; personalAsignadoIds: string[] } {
  const elegibles = new Map<string, string | null>();
  for (const dia of ot.dias) {
    for (const t of tecnicosDeCuadrillaEnDia(miembros, ot.grupo, dia)) {
      elegibles.set(t.nombre, t.usuarioId);
    }
  }
  const nombres = ot.personalAsignado.filter(n => elegibles.has(n));
  const ids = nombres
    .map(n => elegibles.get(n))
    .filter((id): id is string => !!id);
  return { personalAsignado: nombres, personalAsignadoIds: ids };
}

/**
 * Semilla de membresía Diurno/Nocturno a partir de la asistencia real
 * (día por día) de un técnico del roster. Ignora códigos que no son D/N
 * (T, V, CS, L, "").
 */
export function seedMembresiaDesdeAsistencia(
  tecnico: { nombre: string; usuarioId: string | null; asistencia: string[] }
): { grupo: string; dia: string; tecnicoNombre: string; tecnicoUsuarioId: string | null }[] {
  const seeds: { grupo: string; dia: string; tecnicoNombre: string; tecnicoUsuarioId: string | null }[] = [];
  for (const dia of DIAS_SEMANA) {
    const codigo = tecnico.asistencia[DIA_INDEX[dia]];
    if (codigo !== "D" && codigo !== "N") continue;
    seeds.push({
      grupo: codigo === "N" ? "Nocturno" : "Diurno",
      dia,
      tecnicoNombre: tecnico.nombre,
      tecnicoUsuarioId: tecnico.usuarioId,
    });
  }
  return seeds;
}

/** Expande "desde este día" a los días restantes de la semana laboral (Lu-Vi) a partir de diaInicio. */
export function diasDesde(diaInicio: string, dias: string[] = DIAS_SEMANA): string[] {
  const idx = dias.indexOf(diaInicio);
  if (idx === -1) return [diaInicio];
  return dias.slice(idx);
}
