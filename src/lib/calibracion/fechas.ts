// Utilidades de fecha para el programa de calibración. Todas trabajan con
// cadenas "YYYY-MM-DD" (día calendario de Bolivia) y aritmética UTC, para no
// depender de la zona horaria del servidor.

const MS_DIA = 86_400_000;
const OFFSET_BOLIVIA_H = 4; // Bolivia = UTC-4 sin horario de verano

export type Ymd = string;

export function normalizarTag(tag: string): string {
  return tag.replace(/[-\s]/g, "").toUpperCase();
}

function aUtcMs(ymd: Ymd): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function deUtcMs(ms: number): Ymd {
  const f = new Date(ms);
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}-${String(f.getUTCDate()).padStart(2, "0")}`;
}

/** Acepta "dd/mm/yy" o "dd/mm/yyyy". Devuelve null si no es una fecha real. */
export function parseFechaDMY(texto: string | null | undefined): Ymd | null {
  if (!texto) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const ymd = deUtcMs(Date.UTC(anio, mes - 1, dia));
  return ymd === `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}` ? ymd : null;
}

export function addDays(ymd: Ymd, dias: number): Ymd {
  return deUtcMs(aUtcMs(ymd) + dias * MS_DIA);
}

export function diffDays(a: Ymd, b: Ymd): number {
  return Math.round((aUtcMs(a) - aUtcMs(b)) / MS_DIA);
}

/** Medianoche UTC del día: formato de las columnas @db.Date. */
export function ymdToDateUtc(ymd: Ymd): Date {
  return new Date(aUtcMs(ymd));
}

/** Medianoche de Bolivia (04:00Z): mismo formato con que el sistema guarda `RegistroCalibracion.fecha`. */
export function ymdToFechaBolivia(ymd: Ymd): Date {
  return new Date(aUtcMs(ymd) + OFFSET_BOLIVIA_H * 3_600_000);
}

export function dateToYmdBolivia(fecha: Date): Ymd {
  return deUtcMs(fecha.getTime() - OFFSET_BOLIVIA_H * 3_600_000);
}

export function dateToYmdUtc(fecha: Date): Ymd {
  return deUtcMs(fecha.getTime());
}

export function mesDe(ymd: Ymd): string {
  return ymd.slice(0, 7);
}

/** Domingo de la semana ISO que contiene `ymd`. */
export function finSemanaIso(ymd: Ymd): Ymd {
  const diaSemana = new Date(aUtcMs(ymd)).getUTCDay(); // 0 = domingo
  return addDays(ymd, diaSemana === 0 ? 0 : 7 - diaSemana);
}

/** Semana ISO 8601 y el año ISO al que pertenece. */
export function semanaIso(ymd: Ymd): { anio: number; semana: number } {
  const f = new Date(aUtcMs(ymd));
  const dia = f.getUTCDay() || 7;
  f.setUTCDate(f.getUTCDate() + 4 - dia); // jueves de esa semana
  const inicioAnio = Date.UTC(f.getUTCFullYear(), 0, 1);
  return {
    anio: f.getUTCFullYear(),
    semana: Math.ceil(((f.getTime() - inicioAnio) / MS_DIA + 1) / 7),
  };
}

export function claveSemana(ymd: Ymd): string {
  const { anio, semana } = semanaIso(ymd);
  return `${anio}-W${String(semana).padStart(2, "0")}`;
}
