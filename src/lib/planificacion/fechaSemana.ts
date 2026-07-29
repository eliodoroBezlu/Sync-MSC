/**
 * Cálculo de fechas de la semana ISO (Lu-Do) a partir de semana/año — usado
 * tanto por el PDF del Plan Semanal como por la vista Lista (formato Excel),
 * para que ambos muestren exactamente la misma fecha por día.
 */

import { DIAS_SEMANA } from "./cuadrillas";

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const DIA_NOMBRE: Record<string, string> = {
  Lu: "lunes", Ma: "martes", Mi: "miércoles", Ju: "jueves", Vi: "viernes", Sa: "sábado", Do: "domingo",
};

export function lunesDeSemana(semana: number, anio: number): Date {
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  return lunes;
}

export function fechaLarga(semana: number, anio: number, diaCodigo: string): string {
  const lunes = lunesDeSemana(semana, anio);
  const offset = DIAS_SEMANA.indexOf(diaCodigo);
  const fecha = new Date(lunes);
  fecha.setDate(lunes.getDate() + offset);
  return `${DIA_NOMBRE[diaCodigo]}, ${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}
