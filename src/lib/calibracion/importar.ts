// Parsers puros de los dos Excel de calibración. Reciben filas ya leídas
// (arreglos de celdas como texto) y devuelven datos listos para guardar.

import { normalizarTag, parseFechaDMY, semanaIso, type Ymd } from "./fechas.ts";

/** Error de validación del archivo, seguro de mostrar al usuario. */
export class ErrorImportacion extends Error {}

export interface FilaPrograma {
  tag: string;
  fechaPlan: Ymd;
  semanaIso: number;
  frecuenciaDias: number | null;
  programa: string;
  origen: string;
  otModelo: string | null;
  tipoServicio: string | null;
  horasEstimadas: number | null;
}

// `type` (no interface) para que sea asignable a Prisma.InputJsonValue.
export type PuntoHistorico = {
  lecturaPatron: number;
  lecturaInstrumento: number;
  error: number;
  tolerancia: number;
  aprueba: boolean;
};

export interface CalibracionHistorica {
  numeroCertificado: string;
  tag: string;
  fecha: Ymd;
  responsable: string;
  otAsociada: string | null;
  puntosAntes: PuntoHistorico[];
  puntos: PuntoHistorico[];
}

export interface ResultadoParseo<T> {
  filas: T[];
  omitidas: number;
}

type Celda = string | number | null | undefined;
type Fila = readonly Celda[];

const texto = (c: Celda): string => (c === null || c === undefined ? "" : String(c).trim());

function numero(c: Celda): number | null {
  const t = texto(c).replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** `encabezado` es la fila de títulos; `filas` el resto. Columnas por nombre. */
export function parsePrograma(
  encabezado: Fila,
  filas: readonly Fila[],
): ResultadoParseo<FilaPrograma> {
  const col = (nombre: string): number => encabezado.findIndex((h) => texto(h) === nombre);
  const iTag = col("TAG");
  const iPlan = col("Fecha Planificada");
  if (iTag < 0 || iPlan < 0) {
    throw new ErrorImportacion('El archivo debe tener las columnas "TAG" y "Fecha Planificada"');
  }
  const [iFrec, iProg, iOrig, iOt, iTipo, iHoras] = [
    "Frecuencia",
    "Programa",
    "Origen",
    "OT Modelo",
    "Tipo Servicio",
    "Horas Estimadas",
  ].map(col);

  const vistos = new Set<string>();
  const salida: FilaPrograma[] = [];
  let omitidas = 0;

  for (const fila of filas) {
    const tag = normalizarTag(texto(fila[iTag]));
    const fechaPlan = parseFechaDMY(texto(fila[iPlan]));
    if (!tag || !fechaPlan) {
      omitidas += 1;
      continue;
    }
    const programa = (iProg >= 0 && texto(fila[iProg])) || "WG";
    const clave = `${tag}|${fechaPlan}|${programa}`;
    if (vistos.has(clave)) {
      omitidas += 1;
      continue;
    }
    vistos.add(clave);
    const frecuencia = iFrec >= 0 ? numero(fila[iFrec]) : null;
    salida.push({
      tag,
      fechaPlan,
      semanaIso: semanaIso(fechaPlan).semana,
      frecuenciaDias: frecuencia === null ? null : Math.round(frecuencia),
      programa,
      origen: (iOrig >= 0 && texto(fila[iOrig])) || "WG",
      otModelo: iOt >= 0 ? texto(fila[iOt]) || null : null,
      tipoServicio: iTipo >= 0 ? texto(fila[iTipo]) || null : null,
      horasEstimadas: iHoras >= 0 ? numero(fila[iHoras]) : null,
    });
  }
  return { filas: salida, omitidas };
}

// Planilla histórica: N°(0), fecha(2), responsable(5), tipo(7), tag(8), OT(9),
// luego pares Patrón/Lectura desde la columna 10.
const C_NUM = 0;
const C_FECHA = 2;
const C_RESP = 5;
const C_TIPO = 7;
const C_TAG = 8;
const C_OT = 9;
const C_PARES = 10;
const MAX_PARES = 9;

function leerPuntos(fila: Fila): PuntoHistorico[] {
  const puntos: PuntoHistorico[] = [];
  for (let k = 0; k < MAX_PARES; k += 1) {
    const patron = numero(fila[C_PARES + 2 * k]);
    const lectura = numero(fila[C_PARES + 2 * k + 1]);
    if (patron === null || lectura === null) continue;
    puntos.push({
      lecturaPatron: patron,
      lecturaInstrumento: lectura,
      error: Math.round((lectura - patron) * 1e6) / 1e6,
      tolerancia: 0,
      aprueba: true,
    });
  }
  return puntos;
}

interface Grupo {
  num: string;
  fecha: Ymd;
  tag: string;
  responsable: string;
  ot: string;
  antes: PuntoHistorico[];
  calibrado: PuntoHistorico[];
}

/** `filas` son las filas de datos (sin encabezados). Une Antes + Calibrado por N°|fecha|tag. */
export function parseHistorico(filas: readonly Fila[]): ResultadoParseo<CalibracionHistorica> {
  const grupos = new Map<string, Grupo>();
  let omitidas = 0;

  for (const fila of filas) {
    const fecha = parseFechaDMY(texto(fila[C_FECHA]));
    const tag = normalizarTag(texto(fila[C_TAG]));
    const num = texto(fila[C_NUM]);
    const ot = texto(fila[C_OT]);
    if (!fecha || !tag || !num || ot.toUpperCase() === "ANULADO") {
      omitidas += 1;
      continue;
    }
    const clave = `${num}|${fecha}|${tag}`;
    const grupo: Grupo = grupos.get(clave) ?? {
      num,
      fecha,
      tag,
      responsable: texto(fila[C_RESP]),
      ot,
      antes: [],
      calibrado: [],
    };
    const puntos = leerPuntos(fila);
    const esAntes = texto(fila[C_TIPO]).toLowerCase() === "antes";
    grupos.set(clave, {
      ...grupo,
      responsable: grupo.responsable || texto(fila[C_RESP]),
      antes: esAntes ? puntos : grupo.antes,
      calibrado: esAntes ? grupo.calibrado : puntos,
    });
  }

  const salida: CalibracionHistorica[] = [...grupos.values()].map((g) => ({
    numeroCertificado: `HIST-${g.fecha.replaceAll("-", "")}-${g.num}-${g.tag}`,
    tag: g.tag,
    fecha: g.fecha,
    responsable: g.responsable,
    otAsociada: g.ot || null,
    puntosAntes: g.antes,
    puntos: g.calibrado.length > 0 ? g.calibrado : g.antes,
  }));
  return { filas: salida, omitidas };
}
