import { TurnoTipo } from "@/types";
import { semanaYaFinalizo } from "@/lib/semana";

// Turnos: Diurno 06:30–18:29 · Nocturno 18:30–06:29 (cruza medianoche)
// Si son las 00:00–06:29, el turno nocturno pertenece al día ANTERIOR
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getFechaTurno(): { fecha: string; turno: TurnoTipo } {
  const ahora = new Date();
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  const INICIO_DIA   = 6 * 60 + 30;   // 06:30
  const INICIO_NOCHE = 18 * 60 + 30;  // 18:30
  if (min >= INICIO_NOCHE) {
    return { fecha: localDateStr(ahora), turno: "Nocturno" };
  } else if (min < INICIO_DIA) {
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    return { fecha: localDateStr(ayer), turno: "Nocturno" };
  }
  return { fecha: localDateStr(ahora), turno: "Diurno" };
}

export function autoTurno(): TurnoTipo { return getFechaTurno().turno; }

// Determina si una OT OPEPLANT/turnero de la semana (semanaOT, anioOT) puede cerrarse
// ahora mismo. Dos casos:
//  1. La semana de la OT ya terminó por completo (es anterior a la semana real actual,
//     es decir el calendario ya cruzó a la semana siguiente) → siempre se puede cerrar,
//     sin restricción de día. Esto es lo que le da el margen del lunes al técnico que
//     cierra el turno noche del domingo: apenas cruza la medianoche, su semana pasa a
//     "semana anterior" (navegable con el selector) y queda habilitada sin importar la hora.
//  2. La semana de la OT es la semana real en curso → solo se puede cerrar el propio
//     domingo de esa semana (su último día).
// Una OT de una semana futura (no debería ocurrir) queda bloqueada.
export function estaEnVentanaCierreSemanal(params: {
  semanaOT: number;
  anioOT: number;
  semanaActual: number;
  anioActual: number;
}): boolean {
  const { semanaOT, anioOT, semanaActual, anioActual } = params;
  if (semanaYaFinalizo(semanaOT, anioOT, semanaActual, anioActual)) return true;
  if (semanaOT !== semanaActual || anioOT !== anioActual) return false;
  return new Date().getDay() === 0; // Domingo real: último día de la semana en curso
}
