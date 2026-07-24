export type OtBorrador = {
  id: string; control: number | null; numeroOT: string; tipoOT: string;
  tipoTrabajo: string; descripcion: string; tag: string; descripcionEquipo: string;
  personas: number; hrsTrabajo: number; hhTotal: number;
  fechaInicioOt: string | null; fechaFinOt: string | null;
  diasTexto: string | null; dias: string[];
  grupo: string; personalAsignado: string[]; esGuardia: boolean;
};

export type RosterItem = {
  id: string; nombre: string; grupo: string; disciplina: string;
  asistencia: string[]; esContratista: boolean;
};

export type Plan = {
  id: string; semana: number; anio: number; areaCodigo: string; disciplina: string;
  estado: string; creadoPor: string;
  ots: OtBorrador[];
  roster: RosterItem[];
};
