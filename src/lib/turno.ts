import { TurnoTipo } from "@/types";

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

// Ventana de cierre semanal para OTs OPEPLANT/turnero: habilitada domingo y lunes
// (día de turno, no reloj), para dar margen a quien termina el turno noche del
// domingo (que se extiende hasta las 06:29 del lunes) y de paso cubrir todo el lunes.
export function estaEnVentanaCierreSemanal(shiftFecha: string): boolean {
  const diaTurno = new Date(shiftFecha + "T12:00:00").getDay(); // 0=Domingo, 1=Lunes
  return diaTurno === 0 || diaTurno === 1;
}
