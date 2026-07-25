/**
 * Estadísticas de horas-hombre por grupo/día, réplica del formato del Excel
 * de referencia (Programa Semanal Instrumentacion, hoja I-XX): por cada
 * grupo (G1-G4|Diurno|Nocturno) y día, cuántas horas hombre hay disponibles
 * (headcount de la cuadrilla × 10 hrs/día, o un override manual), cuántas
 * están programadas (suma de hhPorDia de las OTs de ese grupo/día) y el
 * % de utilización resultante — más los agregados semanales (totales,
 * horas de atención reactiva sobrantes, promedio de utilización por grupo
 * y por día) que el Excel calcula en sus filas 1-8.
 */

import type { CuadrillaMatriz } from "./cuadrillas";
import { DIAS_SEMANA } from "./cuadrillas";

const HORAS_POR_PERSONA_DIA = 10;

/** {grupo: {dia: horasDisponiblesOverride}} — ausente = automático (headcount x 10). */
export type CapacidadOverride = Record<string, Record<string, number>>;

export interface OtParaCapacidad {
  grupo: string;
  dias: string[];
  hhTotal: number;
}

export interface CapacidadGrupoDia {
  grupo: string;
  dia: string;
  headcount: number;
  horasDisponibles: number;
  esManual: boolean;
  horasProgramadas: number;
  utilizacion: number;
}

export interface CapacidadDiaResumen {
  dia: string;
  horasDisponibles: number;
  horasProgramadas: number;
  utilizacion: number;
}

export interface CapacidadGrupoResumen {
  grupo: string;
  utilizacionPromedio: number;
}

export interface ReporteCapacidad {
  grupos: string[];
  porGrupoDia: CapacidadGrupoDia[];
  porDia: CapacidadDiaResumen[];
  porGrupo: CapacidadGrupoResumen[];
  totalDisponible: number;
  totalProgramada: number;
  horasReactivo: number;
  utilizacionSemana: number;
}

// Mismo orden que TableroSemanal.tsx / ordenes/semanales para que la lectura
// del resumen coincida con el orden visual de las columnas del tablero.
const GRUPOS_ORDEN = ["G1", "G2", "G3", "G4", "Diurno", "Nocturno"];

function ordenarGrupos(presentes: Set<string>): string[] {
  const ordenados = GRUPOS_ORDEN.filter(g => presentes.has(g));
  for (const g of presentes) {
    if (!ordenados.includes(g)) ordenados.push(g);
  }
  return ordenados;
}

function hhPorDia(ot: OtParaCapacidad): number {
  return ot.hhTotal / Math.max(1, ot.dias.length);
}

function utilizacion(programadas: number, disponibles: number): number {
  return disponibles > 0 ? programadas / disponibles : 0;
}

export function calcularReporteCapacidad(
  ots: OtParaCapacidad[],
  cuadrilla: CuadrillaMatriz,
  override: CapacidadOverride = {},
  dias: string[] = DIAS_SEMANA
): ReporteCapacidad {
  const presentes = new Set<string>([
    ...Object.keys(cuadrilla),
    ...ots.map(o => o.grupo),
    ...Object.keys(override),
  ]);
  const grupos = ordenarGrupos(presentes);

  const porGrupoDia: CapacidadGrupoDia[] = [];
  for (const grupo of grupos) {
    for (const dia of dias) {
      const headcount = cuadrilla[grupo]?.[dia]?.length ?? 0;
      const manual = override[grupo]?.[dia];
      const horasDisponibles = manual ?? headcount * HORAS_POR_PERSONA_DIA;
      const horasProgramadas = ots
        .filter(o => o.grupo === grupo && o.dias.includes(dia))
        .reduce((s, o) => s + hhPorDia(o), 0);
      porGrupoDia.push({
        grupo,
        dia,
        headcount,
        horasDisponibles,
        esManual: manual != null,
        horasProgramadas,
        utilizacion: utilizacion(horasProgramadas, horasDisponibles),
      });
    }
  }

  const porDia: CapacidadDiaResumen[] = dias.map(dia => {
    const filas = porGrupoDia.filter(f => f.dia === dia);
    const horasDisponibles = filas.reduce((s, f) => s + f.horasDisponibles, 0);
    const horasProgramadas = filas.reduce((s, f) => s + f.horasProgramadas, 0);
    return { dia, horasDisponibles, horasProgramadas, utilizacion: utilizacion(horasProgramadas, horasDisponibles) };
  });

  const porGrupo: CapacidadGrupoResumen[] = grupos.map(grupo => {
    const filas = porGrupoDia.filter(f => f.grupo === grupo);
    const promedio = filas.length > 0 ? filas.reduce((s, f) => s + f.utilizacion, 0) / filas.length : 0;
    return { grupo, utilizacionPromedio: promedio };
  });

  const totalDisponible = porDia.reduce((s, d) => s + d.horasDisponibles, 0);
  const totalProgramada = porDia.reduce((s, d) => s + d.horasProgramadas, 0);

  return {
    grupos,
    porGrupoDia,
    porDia,
    porGrupo,
    totalDisponible,
    totalProgramada,
    horasReactivo: totalDisponible - totalProgramada,
    utilizacionSemana: utilizacion(totalProgramada, totalDisponible),
  };
}

/** Horas disponibles de un grupo/día puntual — usado por TableroSemanal para el pill-header sin recalcular todo el reporte. */
export function horasDisponiblesGrupoDia(
  grupo: string,
  dia: string,
  cuadrilla: CuadrillaMatriz,
  override: CapacidadOverride = {}
): { horasDisponibles: number; esManual: boolean; headcount: number } {
  const headcount = cuadrilla[grupo]?.[dia]?.length ?? 0;
  const manual = override[grupo]?.[dia];
  return { horasDisponibles: manual ?? headcount * HORAS_POR_PERSONA_DIA, esManual: manual != null, headcount };
}
