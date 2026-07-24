// Número de semana ISO-8601 (jueves-based)
export function getWeekNumber(d: Date): number {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt.getTime() - y.getTime()) / 86400000) + 1) / 7);
}

// Devuelve las 7 fechas (Lun-Dom) de la semana dada
export function getWeekDates(semana: number, anio: number): Date[] {
  // Encontrar el 4 de enero (siempre en la semana 1)
  const jan4 = new Date(anio, 0, 4);
  // Lunes de la semana 1
  const lunes1 = new Date(jan4);
  lunes1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  // Lunes de la semana deseada
  const lunesSemana = new Date(lunes1);
  lunesSemana.setDate(lunes1.getDate() + (semana - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunesSemana);
    d.setDate(lunesSemana.getDate() + i);
    return d;
  });
}

// Dado (semana, año) base y un desplazamiento en semanas, devuelve la semana/año resultante
// (maneja el cruce de año calculando a partir del lunes real de la semana base)
export function getSemanaAnioOffset(baseSemana: number, baseAnio: number, offsetSemanas: number): { semana: number; anio: number } {
  const lunes = getWeekDates(baseSemana, baseAnio)[0];
  lunes.setDate(lunes.getDate() + offsetSemanas * 7);
  return { semana: getWeekNumber(lunes), anio: lunes.getFullYear() };
}

// True si (semana, anio) es una semana estrictamente anterior a (semanaActual, anioActual)
export function semanaYaFinalizo(semana: number, anio: number, semanaActual: number, anioActual: number): boolean {
  if (anio !== anioActual) return anio < anioActual;
  return semana < semanaActual;
}

// Lunes 00:00 de la semana actual, hora Bolivia (UTC-4) — mismo cálculo que
// usa src/app/ordenes/reporte/page.tsx en el cliente, reutilizable server-side.
export function lunesEstaSemanaBolivia(referencia: Date = new Date()): Date {
  const d = new Date(referencia);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  d.setUTCHours(4, 0, 0, 0); // medianoche Bolivia = 4 AM UTC
  return d;
}

export function semanaActualBolivia(referencia: Date = new Date()): { semana: number; anio: number; fechaInicio: Date; fechaFin: Date } {
  const lunes = lunesEstaSemanaBolivia(referencia);
  const domingo = new Date(lunes);
  domingo.setUTCDate(domingo.getUTCDate() + 6);
  return { semana: getWeekNumber(lunes), anio: lunes.getUTCFullYear(), fechaInicio: lunes, fechaFin: domingo };
}
