import type { TableroParada } from "@/lib/parada/tipos";

export type { TableroParada };

export type TurnoParada = "Dia" | "Noche";
export type FaseParada = "preparativos" | "ejecucion";
export type EstadoParada = "preparativos" | "ejecucion" | "cerrada";
export type ReunionParada = "08:00" | "17:00";

export interface ParadaGrupoMiembroCli {
  usuarioId: string | null;
  nombre: string;
  esLider: boolean;
}

export interface ParadaGrupoCli {
  _id: string;
  id: string;
  paradaId: string;
  turno: TurnoParada;
  disciplina: string; // ELEC | INST | TESA | MIXTO
  supervisorNombre: string;
  supervisorUsuarioId: string | null;
  dotacionPropia: number;
  dotacionApoyo: number;
  miembros: ParadaGrupoMiembroCli[];
}

export interface ParadaOtCli {
  _id: string;
  id: string;
  paradaId: string;
  numeroOT: string;
  ordenTrabajoId: string | null;
  descripcion: string;
  tag: string;
  descripcionEquipo: string;
  disciplina: string; // ELEC | INST | TESA
  fase: FaseParada;
  hhEstimadas: number;
  fechaProg: string | null;
  fechaProgFin: string | null;
  grupo: "Dia" | "Noche" | "Ambos";
  responsable: string | null;
  critica: boolean;
  estado: string;
  avancePct: number;
  observaciones: string | null;
  orden: number | null;
  personalAsignado: string[];
  personalAsignadoIds: string[];
}

export interface OtConRetraso {
  numeroOT: string;
  motivo: string;
  accion: string;
}

export interface PendienteParada {
  tipo: "material" | "repuesto" | "permiso" | "apoyo" | "otro";
  detalle: string;
}

export interface ParadaReporteCli {
  _id: string;
  id: string;
  paradaId: string;
  fecha: string;
  turno: TurnoParada;
  reunion: ReunionParada;
  supervisorNombre: string;
  supervisorUsuarioId: string | null;
  resumen: string;
  avanceGlobalPct: number;
  hhPropias: number;
  hhApoyo: number;
  otsTerminadas: string[];
  otsConRetraso: OtConRetraso[];
  pendientes: PendienteParada[];
  observaciones: string | null;
  estado: "borrador" | "emitido";
  pdfUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParadaDetalle {
  _id: string;
  id: string;
  codigo: string;
  nombre: string;
  planta: string | null;
  fechaPreparativosInicio: string;
  fechaEjecucionInicio: string;
  fechaEjecucionFin: string;
  estado: EstadoParada;
  fechaCierre: string | null;
  leccionesAprendidas: string | null;
  observacionesCierre: string | null;
  creadoPor: string;
  createdAt: string;
  updatedAt: string;
  ots: ParadaOtCli[];
  grupos: ParadaGrupoCli[];
  reportesDiarios: ParadaReporteCli[];
}

export interface ParadaResumen {
  _id: string;
  id: string;
  codigo: string;
  nombre: string;
  planta: string | null;
  fechaPreparativosInicio: string;
  fechaEjecucionInicio: string;
  fechaEjecucionFin: string;
  estado: string;
  creadoPor: string;
  _count: { ots: number; grupos: number; reportesDiarios: number };
}

export interface AvanceCli {
  _id: string;
  id: string;
  paradaId: string;
  paradaOtId: string;
  fecha: string;
  turno: TurnoParada;
  avancePct: number;
  hhPropias: number;
  hhApoyo: number;
  estado: string;
  comentario: string | null;
  registradoPor: string;
}

export interface TableroResponse {
  parada: {
    _id: string;
    id: string;
    codigo: string;
    nombre: string;
    estado: EstadoParada;
    fechaPreparativosInicio: string;
    fechaEjecucionInicio: string;
    fechaEjecucionFin: string;
  };
  tablero: TableroParada;
}

export const NARANJA = "#ea580c";

export const ESTADO_OT_META: Record<string, { label: string; color: string; bg: string }> = {
  no_iniciada: { label: "No iniciada", color: "#64748b", bg: "#f1f5f9" },
  en_ejecucion: { label: "En ejecución", color: "#0369a1", bg: "#e0f2fe" },
  terminada: { label: "Terminada", color: "#15803d", bg: "#dcfce7" },
  con_retraso: { label: "Con retraso", color: "#b91c1c", bg: "#fee2e2" },
};

export const ESTADO_PARADA_META: Record<string, { label: string; color: string }> = {
  preparativos: { label: "Preparativos", color: "#d97706" },
  ejecucion: { label: "En ejecución", color: "#ea580c" },
  cerrada: { label: "Cerrada", color: "#16a34a" },
};
