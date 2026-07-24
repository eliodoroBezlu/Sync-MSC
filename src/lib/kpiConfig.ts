// Umbrales de semáforo para los KPIs de mantenimiento. Ajustables sin tocar
// la lógica de cómputo — ver src/lib/kpi.ts.

export type Semaforo = "verde" | "ambar" | "rojo";

// % Cumplimiento del Programa: más alto es mejor.
export const META_CUMPLIMIENTO = { verde: 90, ambar: 75 };

// % HH Reactivo/No-Programado: más bajo es mejor (banda invertida).
export const META_REACTIVO = { verde: 10, ambar: 25 };

export function bandaCumplimiento(pct: number | null): Semaforo | null {
  if (pct === null) return null;
  if (pct >= META_CUMPLIMIENTO.verde) return "verde";
  if (pct >= META_CUMPLIMIENTO.ambar) return "ambar";
  return "rojo";
}

export function bandaReactivo(pct: number | null): Semaforo | null {
  if (pct === null) return null;
  if (pct <= META_REACTIVO.verde) return "verde";
  if (pct <= META_REACTIVO.ambar) return "ambar";
  return "rojo";
}

export const SEMAFORO_COLOR: Record<Semaforo, string> = {
  verde: "#16a34a",
  ambar: "#d97706",
  rojo: "#dc2626",
};

// Estados de OrdenTrabajo en los que se considera que hubo trabajo ejecutado
// (todo excepto "borrador", que es el técnico llenando el formulario sin enviar).
export const ESTADOS_TRABAJO_REALIZADO = ["pendiente_revision", "solicitar_correccion", "revisado", "concluido"];

// tipoOT de OtLinea considerados correctivos no programados (Pareto de reactivas).
export const TIPOS_CORRECTIVO = ["CMP", "CMR"];

export const PARETO_TOP_N_DETALLE = 15;

export const TENDENCIA_SEMANAS = 6;
