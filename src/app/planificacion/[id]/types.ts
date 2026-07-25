export type OtBorrador = {
  id: string; control: number | null; numeroOT: string; tipoOT: string;
  tipoTrabajo: string; descripcion: string; tag: string; descripcionEquipo: string;
  personas: number; hrsTrabajo: number; hhTotal: number;
  fechaInicioOt: string | null; fechaFinOt: string | null;
  diasTexto: string | null; dias: string[];
  grupo: string; personalAsignado: string[]; esGuardia: boolean;
  seleccionada: boolean;
  motivoNoProgramada: string | null;
  comentarioNoProgramada: string | null;
  esBacklog: boolean;
  solicitante: string | null;
  observaciones: string | null;
};

export type RosterItem = {
  id: string; nombre: string; usuarioId: string | null; grupo: string; disciplina: string;
  asistencia: string[]; esContratista: boolean;
};

export type TecnicoRef = { nombre: string; usuarioId: string | null };

// {grupo: {dia: [técnicos]}} — quién cubre cada cuadrilla cada día.
export type CuadrillaMatriz = Record<string, Record<string, TecnicoRef[]>>;

// {grupo: {dia: horasDisponiblesOverride}} — ausente = cálculo automático.
export type CapacidadOverride = Record<string, Record<string, number>>;

export type Plan = {
  id: string; semana: number; anio: number; areaCodigo: string; disciplina: string;
  estado: string; creadoPor: string;
  capacidadOverride: CapacidadOverride;
  ots: OtBorrador[];
  roster: RosterItem[];
};
