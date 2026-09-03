// Tipos compartidos del módulo "Parada de Planta".
// La lógica de indicadores (src/lib/parada/indicadores.ts) es pura y sólo
// depende de estos tipos, no del cliente Prisma, para poder testearse aislada.

export type DisciplinaParada = "ELEC" | "INST" | "TESA";
export type FaseParada = "preparativos" | "ejecucion";
export type TurnoParada = "Dia" | "Noche";
export type EstadoOtParada =
  | "no_iniciada"
  | "en_ejecucion"
  | "terminada"
  | "con_retraso";
export type EstadoParada = "preparativos" | "ejecucion" | "cerrada";
export type Reunion = "08:00" | "17:00";

export const DISCIPLINAS_PARADA: readonly DisciplinaParada[] = [
  "ELEC",
  "INST",
  "TESA",
] as const;

/** Subconjunto de `ParadaOt` que necesita el cálculo del tablero. */
export interface OtParadaCalc {
  id: string;
  numeroOT: string;
  disciplina: string;
  fase: string;
  hhEstimadas: number;
  fechaProg: Date | string | null;
  estado: string;
  avancePct: number;
}

/** Subconjunto de `ParadaAvanceDiario` que necesita el cálculo del tablero. */
export interface AvanceParadaCalc {
  paradaOtId: string;
  fecha: Date | string;
  turno: string;
  avancePct: number;
  hhPropias: number;
  hhApoyo: number;
  estado: string;
}

/** Entrada de `calcularTablero`. */
export interface ParadaCalc {
  fechaEjecucionInicio: Date | string;
  fechaEjecucionFin: Date | string;
  ots: OtParadaCalc[];
  avances: AvanceParadaCalc[];
}

export interface ConteoOts {
  total: number;
  terminadas: number;
  enEjecucion: number;
  noIniciadas: number;
  conRetraso: number;
}

export interface IndicadorDisciplina {
  avancePct: number;
  otsTotal: number;
  otsTerminadas: number;
  hhReal: number;
  hhEst: number;
}

export interface PuntoSerieDiaria {
  fecha: string; // YYYY-MM-DD
  avancePlanAcum: number;
  avanceRealAcum: number;
  hhReal: number;
}

export interface DiaActual {
  indice: number; // 1..total
  total: number;
  etiqueta: string; // "Día 2 de 3"
  previa: boolean; // true si aún no se llega a la fecha de inicio de ejecución
  avancePlan: number;
  avanceReal: number;
}

export interface TableroParada {
  avanceGlobalPct: number;
  ots: ConteoOts & {
    preparativos: ConteoOts;
    ejecucion: ConteoOts;
  };
  /** 0..1 — OTs terminadas sobre OTs programadas hasta hoy. */
  cumplimientoHoy: number;
  porDisciplina: Record<DisciplinaParada, IndicadorDisciplina>;
  hh: {
    hhEst: number;
    hhReal: number;
    factorProductividad: number;
  };
  diaActual: DiaActual;
  serieDiaria: PuntoSerieDiaria[];
}
