/**
 * Colores de grupo y helpers de asistencia/personal compartidos entre el
 * Tablero (kanban) y la Lista (formato Excel) — para que ambas vistas de la
 * pestaña Programación se vean idénticas en tipografía y colores.
 */

export const DIAS_INFO = [
  { code: "Lu", largo: "Lunes" },
  { code: "Ma", largo: "Martes" },
  { code: "Mi", largo: "Miércoles" },
  { code: "Ju", largo: "Jueves" },
  { code: "Vi", largo: "Viernes" },
  { code: "Sa", largo: "Sábado" },
  { code: "Do", largo: "Domingo" },
] as const;

// Mismo orden y colores que el Plan Semanal publicado (src/app/ordenes/semanales)
// para que la agrupación por turno se vea consistente en todas las pantallas.
export const GRUPOS_ORDEN = ["G1", "G2", "G3", "G4", "Diurno", "Nocturno"];

export const GRUPO_COLOR: Record<string, { bg: string; color: string }> = {
  G1: { bg: "#dbeafe", color: "#1d4ed8" },
  G2: { bg: "#dcfce7", color: "#166534" },
  G3: { bg: "#fef3c7", color: "#92400e" },
  G4: { bg: "#ede9fe", color: "#5b21b6" },
  Diurno: { bg: "#ffedd5", color: "#9a3412" },
  Nocturno: { bg: "#1e293b", color: "#e2e8f0" },
};

export function grupoColor(g: string): { bg: string; color: string } {
  return GRUPO_COLOR[g] ?? { bg: "#f1f5f9", color: "#475569" };
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

// Un técnico está "en sitio" esta semana si tiene T (turno normal/guardia
// diurna) o N (turno nocturno) al menos un día — D es descanso (código de
// RRHH, no "diurno" pese a la letra) y V/CS/L/"" son ausencias (vacación,
// comisión de servicio, licencia).
export function estaEnSitio(asistencia: string[]): boolean {
  return asistencia.some(a => a === "T" || a === "N");
}

// Mismo criterio T/N que estaEnSitio, pero para un día puntual.
export function trabajaEseDia(asistencia: string[], diaCode: string): boolean {
  const idx = DIAS_INFO.findIndex(d => d.code === diaCode);
  if (idx === -1) return true;
  const a = asistencia[idx];
  return a === "T" || a === "N";
}
