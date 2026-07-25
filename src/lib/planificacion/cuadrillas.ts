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

/**
 * Resumen semanal (mayoría turno nocturno/diurno) para RosterSemanal.grupo —
 * solo display, ver CuadrillaMiembro para asignación real.
 *
 * "D" es código de descanso (RRHH), no de turno diurno — no cuenta aquí. El
 * turno diurno real lo marca guardiaDiurna (T con fondo gris en el Excel).
 */
export function calcularGrupo(asistencia: string[], guardiaDiurna: boolean[] = []): string {
  const nocturno = asistencia.filter(a => a === "N").length;
  const diurno = guardiaDiurna.filter(Boolean).length;
  if (nocturno === 0 && diurno === 0) return "Diurno";
  return nocturno > diurno ? "Nocturno" : "Diurno";
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
 * (día por día) de un técnico del roster.
 *
 * Nocturno se siembra desde el código "N". Diurno NO se siembra desde "D"
 * (ese código es descanso/día libre en la codificación de RRHH, no turno
 * diurno) sino desde guardiaDiurna[dia] — la señal de fondo gris sobre una
 * celda "T" que en el Excel distingue "turno diurno" (guardia) de "turno
 * normal" (mismo texto "T", sin ese fondo). El resto de códigos (D, V, CS,
 * L, T sin fondo, "") no siembran nada.
 */
export function seedMembresiaDesdeAsistencia(
  tecnico: { nombre: string; usuarioId: string | null; asistencia: string[]; guardiaDiurna?: boolean[] }
): { grupo: string; dia: string; tecnicoNombre: string; tecnicoUsuarioId: string | null }[] {
  const seeds: { grupo: string; dia: string; tecnicoNombre: string; tecnicoUsuarioId: string | null }[] = [];
  for (const dia of DIAS_SEMANA) {
    const idx = DIA_INDEX[dia];
    const codigo = tecnico.asistencia[idx];
    const esGuardiaDiurna = tecnico.guardiaDiurna?.[idx] === true;
    let grupo: string | null = null;
    if (codigo === "N") grupo = "Nocturno";
    else if (esGuardiaDiurna) grupo = "Diurno";
    if (!grupo) continue;
    seeds.push({ grupo, dia, tecnicoNombre: tecnico.nombre, tecnicoUsuarioId: tecnico.usuarioId });
  }
  return seeds;
}

/** Expande "desde este día" a los días restantes de la semana laboral (Lu-Vi) a partir de diaInicio. */
export function diasDesde(diaInicio: string, dias: string[] = DIAS_SEMANA): string[] {
  const idx = dias.indexOf(diaInicio);
  if (idx === -1) return [diaInicio];
  return dias.slice(idx);
}
