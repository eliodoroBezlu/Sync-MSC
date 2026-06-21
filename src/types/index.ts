// ─── Roles ────────────────────────────────────────────────────────────────────
// 1 = Administrador  2 = Superintendente  3 = Supervisor  4 = Técnico  5 = Planificador  6 = Contratista
export type Rol = 1 | 2 | 3 | 4 | 5 | 6;

// ─── Disciplina ───────────────────────────────────────────────────────────────
// GENERAL = acceso a módulos de OT (default)
// INST    = acceso exclusivo a Calibración
export type Disciplina = "GENERAL" | "MEC" | "ELEC" | "INST";

// ─── OT domain literals ───────────────────────────────────────────────────────
export type TurnoTipo = "Diurno" | "Nocturno" | "Parada de Planta" | "Otro";

export type TipoOT = "CMP" | "CMR" | "PMP" | "PMT" | "PDM" | "PTJ";
// CMP = Correctivo Mayor Programado   (ISO: Corrective major)
// CMR = Correctivo Menor Rutinario    (ISO: Corrective minor)
// PMP = Preventivo Mayor Programado   (ISO: Preventive major)
// PMT = Preventivo Menor de Turno     (ISO: Preventive minor)
// PDM = Mantenimiento Predictivo      (ISO: Predictive)
// PTJ = Proyecto / Trabajo de Ingeniería

export type EstadoOT =
  | "borrador"           // Técnico llenando, no enviado
  | "pendiente_revision" // Enviado, esperando supervisor
  | "solicitar_correccion" // Supervisor solicitó cambios
  | "revisado"           // Supervisor aprobó
  | "concluido";         // Cerrado y bloqueado

export type Criticidad = "A" | "B" | "C";

export type ClasificacionRCM =
  | "Correctivo No Planificado"
  | "Correctivo Programado"
  | "Mantenimiento Menor"
  | "Mantenimiento Mayor";

export type TipoAdjunto = "foto" | "pdf" | "excel" | "otro";

// ─── Colección: usuarios (§2.2) ───────────────────────────────────────────────
export interface IUsuario {
  _id?: string;
  nombre: string;          // Nómina completa (col B ListaGM)
  apellido?: string;       // Opcional (entrada manual)
  email?: string;          // Opcional — requerido solo para login
  passwordHash?: string;
  rol: Rol;
  // Rol 1: ignorado (acceso total). Rol 2–3: áreas gestionadas. Rol 4: área asignada.
  areas: string[];         // Códigos de área de planta (3310, 3320…)
  disciplina?: Disciplina; // GENERAL (default) | INST | MEC | ELEC
  // Campos ListaGM (cols C, F, G, K, L)
  areaTrabajo?: string;    // Área/depto laboral: "Molienda", "Electrico"…
  celular?: string;
  jde?: string;            // Código JDE del empleado
  puesto?: string;
  superintendencia?: string;
  activo: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: areas (§2.4) ──────────────────────────────────────────────────
export interface IArea {
  _id?: string;
  codigo: string;         // JDE code: "3310"–"3321"
  nombre: string;
  superintendencia: string;
  tieneCalibracion: boolean; // true solo para código "3320"
  activo: boolean;
}

// ─── Colección: equipos (§2.4 / §2.5) ────────────────────────────────────────
// Estructura jerárquica ISO 14224 / JDE: Niveles 1-8
// Nivel 1=Planta, 2=Área Funcional, 3=Sistema, 4=Equipo,
// 5=Subequipo, 6=Componente, 7=Parte/Sensor, 8=Sub-elemento
export interface IEquipo {
  _id?: string;
  tag: string;                // Nº unidad / código TAG (col B del Excel)
  descripcion: string;        // Descripción principal (col C)
  descripcion2?: string;      // Descripción 2 / especificación (col D)
  descripcion3?: string;      // Descripción 3 / referencia (col E)
  nivel: number;              // Nivel jerárquico 1–8
  parentTag?: string;         // TAG del padre inmediato (derivado de la jerarquía)
  nivelPath?: string[];       // Ruta de TAGs desde nivel 1 [planta, area, sistema, ...]
  // Tipo / subtipo (catálogo JDE)
  tipoEquipo: string;         // Código tipo (col F): "EMT", "SWT", "HDS"…
  descripcionTipo?: string;   // Descripción del tipo (col G): "Motor Eléctrico"
  subtipo?: string;           // Código subtipo (col H): "AML", "LVL"
  descripcionSubtipo?: string;// Descripción subtipo (col I)
  categoriaISO?: string | null; // Categoría ISO 14224 (MOTORES, BOMBAS…) derivada de tipoEquipo
  // Clasificación
  criticidad?: Criticidad;    // A / B / C (col J)
  centroCosto?: string;       // Código centro de costo JDE (col K)
  areaCodigo: string;         // Código área JDE (col L): 3210, 3211…
  descripcionArea?: string;   // Nombre área (col M)
  // Campos adicionales (entrada manual)
  fabricante?: string;
  modelo?: string;
  serie?: string;
  fechaInstalacion?: Date;
  vidaUtilEstimadaAnos?: number;
  activo: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: arbol_fallas (§2.5) ──────────────────────────────────────────
// Tabla maestra para los selectores en cascada: Síntoma → Causa → Resolución
export interface IArbolFallas {
  _id?: string;
  tipoEquipo?: string | null;  // null = aplica a todos los tipos de equipo
  sintoma: string;             // Modo de falla / síntoma visible
  codigoModo?: string;         // Código ISO 14224 (BRD, ELP, FTS…)
  causaProbable: string;       // Descripción de la causa raíz
  codigoCausa?: string;        // Código MSC de la causa
  resolucionSugerida: string;
  tiempoEstimadoHrs: number;
  activo: boolean;
  creadoPor: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICatalogoModo {
  _id?: string;
  codigo: string;    // BRD, ELP, FTS…
  nombre: string;    // Nombre inglés ISO
  nombreEs: string;  // Nombre en español
  descripcion: string;
}

export interface ICatalogoCausa {
  _id?: string;
  codigo: string;    // Código MSC (AJD, BFR…)
  nombre: string;
  descripcion: string;
}

// ─── Sub-documentos de OrdenTrabajo ──────────────────────────────────────────

export interface IAdjunto {
  tipo: TipoAdjunto;
  url: string;
  nombre: string;
  subidoEn: Date;
}

export interface ILineaOT {
  // Cada OT puede tener múltiples equipos intervenidos
  tag: string;
  descripcionEquipo: string; // desnormalizado de IEquipo.descripcion

  tipoOT: TipoOT;

  // Campos para OTs correctivas (CMP, CMR)
  sintoma?: string;
  causaProbable?: string;
  resolucionAplicada?: string; // texto libre, auto-sugerido pero editable
  tiempoEstimadoHrs?: number;
  tiempoRealHrs?: number;

  // Campos para OTs preventivas/predictivas (PMP, PMT, PTJ)
  descripcionTrabajo?: string;
  tareasEjecutadas?: string[];

  adjuntos: IAdjunto[];
  observaciones?: string;
}

export interface IDatosSupervision {
  // Completado por Supervisor (Rol 3) o superior
  codigoModoFallaISO?: string;   // e.g. "EL-MOT-FASE-01" (ISO 14224)
  clasificacionRCM?: ClasificacionRCM;
  criticidadEquipo?: Criticidad;
  leccionAprendida?: string;
  requierePlanificacion?: boolean;
  otRelacionada?: string;        // número de OT relacionada
  comentariosSupervisor?: string;
  revisadoPor?: string;          // IUsuario._id
  revisadoEn?: Date;
}

export interface ICambioHistorial {
  // Registro inmutable de cada modificación (audit trail)
  fechaHora: Date;
  usuarioId: string;
  nombreUsuario: string; // desnormalizado para display
  cambio: string;
}

export interface ITecnicoRef {
  usuarioId: string;
  nombreCompleto: string; // desnormalizado para display
}

// ─── Colección: ordenes_trabajo (§2.5) ────────────────────────────────────────
// ─── Avance diario para OTs multi-día ────────────────────────────────────────
export interface IRegistroDiario {
  fecha: Date;
  tecnico: string;           // nombreCompleto del técnico que registra
  usuarioId?: string;
  hhTrabajadas: number;
  tareasEjecutadas: string[];
  observaciones?: string;
}

export interface IOrdenTrabajo {
  _id?: string;
  numeroOT: string;                // Auto-generado secuencial interno (#1, #2…)
  fecha: Date;
  turno: TurnoTipo;
  areaCodigo: string;              // ref a IArea.codigo (33xx mantenimiento)
  tecnicos: ITecnicoRef[];
  lineas: ILineaOT[];              // Mínimo 1, soporte para múltiples equipos
  estado: EstadoOT;
  datosSupervision: IDatosSupervision;
  historialCambios: ICambioHistorial[];
  // ── Avances diarios (OTs multi-día) ──
  registrosDiarios?: IRegistroDiario[];
  // ── Enlace al Plan Semanal (ISO 14224 — trazabilidad planificación/ejecución) ──
  origenPlan: boolean;             // true = viene del programa semanal | false = reactiva (CMR/CMP)
  programacionSemanalId?: string;  // ref a ProgramacionSemanal._id
  otJdeNumero?: string;            // numeroOT del plan JDE ("892969") — clave de enlace
  otJdeDia?: string;               // día en el plan ("Lu","Ma"…) para actualizar la entrada correcta
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: reportes_turno (§2.6) ─────────────────────────────────────────
export interface IReporteTurno {
  _id?: string;
  turno: TurnoTipo;
  fecha: Date;
  supervisorId: string;
  supervisorNombre: string;
  otIds: string[];
  otsCriticas: string[];
  otsPendientesSiguienteTurno: string[];
  notasOTs: { otId: string; nota: string }[];
  resumenEjecutivo: {
    totalOTs: number;
    concluidas: number;
    pendientes: number;
    inconclusas: number;
    hhTotales: number;
    hhCorrectivo: number;
    hhPreventivo: number;
  };
  otsPlanData?: {
    otId: string; numeroOT: string; tag: string; disciplina: string;
    grupo: string; tipoOT: string; descripcion: string; tecnicos: string[];
    hhTotal: number; estado: string; heredada?: boolean;
    pasarNocheMotivo?: string; pasarNochePor?: string;
  }[];
  recomendaciones: { prioridad: "URGENTE" | "PLANIFICAR" | "SEGUIMIENTO" | "SEGURIDAD"; area?: string; tag?: string; descripcion: string }[];
  comentariosAreas?: Record<string, string>;
  adjuntos: IAdjunto[];
  estado: "borrador" | "enviado";
  pdfUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: programacion_semanal (§2.8) ───────────────────────────────────
export type EstadoOTProgramada =
  | "no_iniciada" | "en_proceso" | "en_revision"
  | "completada" | "pendiente" | "atrasada" | "bloqueada" | "cancelada";

// Día de la semana abreviado (como en el Excel)
export type DiaSemana = "Lu" | "Ma" | "Mi" | "Ju" | "Vi" | "Sa" | "Do";

// Grupo de trabajo (cuadrilla rotativa o turno fijo)
export type GrupoTrabajo = "G1" | "G2" | "G3" | "G4" | "Diurno" | "Nocturno";

// Estado de asistencia por día (códigos del Excel)
export type EstadoAsistencia =
  | "D"   // Turno Día
  | "N"   // Turno Noche
  | "T"   // Trasnochal
  | "V"   // Vacación
  | "CS"  // Comisión de Servicio
  | "BM"  // Baja Médica
  | "LG"  // Licencia con Goce
  | "FI"  // Falta Injustificada
  | "DO"  // Día Off / Descanso
  | "IF"  // Inicio de Funciones
  | "";   // No registrado

export interface IAsistenciaDia {
  dia: DiaSemana;
  estado: EstadoAsistencia;
}

export interface IPersonalSemanal {
  usuarioId?: string;        // ref a IUsuario (opcional si es contratista)
  nombre: string;            // nombre completo desnormalizado
  grupo: GrupoTrabajo;
  esContratista: boolean;
  asistencia: IAsistenciaDia[]; // 7 entradas Lu→Do
}

export interface IOTProgramada {
  numeroOT: string;           // Número JDE
  tipoOT: string;             // "P" | "C" | "S" (del JDE) — expandido vs TipoOT interno
  tipoTrabajo: string;        // "PdM-MANTENIMIENTO PREDICTIVO", "CMP-MANTTO CORRECTIVO PLANEADO"...
  prioridad?: string;         // "4P", "1P"...
  descripcion: string;        // Job Description del JDE
  tag: string;                // Código equipo
  descripcionEquipo: string;
  personas: number;
  hrsTrabajo: number;         // horas por persona
  hhTotal: number;            // personas × hrsTrabajo
  personalAsignado: string[]; // nombres de técnicos asignados
  personalAsignadoIds?: string[]; // usuarioIds para match exacto por identidad
  grupo: GrupoTrabajo;
  dia: DiaSemana;
  estado: EstadoOTProgramada;
  observaciones?: string;
  // Referencia a la OT interna cuando ya fue registrada por el técnico
  ordenTrabajoId?:  string; // ref a OrdenTrabajo._id
  ordenTrabajoNum?: string; // número interno "#1", "#2"…
  // HH reales ejecutadas (de lineas.tiempoRealHrs o bitácora OPEPLANT)
  hhReales?: number | null;
  esGuardia?: boolean;
  bitacora?: unknown[];
}

export interface IResumenDia {
  dia: DiaSemana;
  fecha: Date;
  hhDisponibles: number;
  hhProgramadas: number;
  utilizacion: number; // porcentaje 0-100
}

export interface IProgramacionSemanal {
  _id?: string;
  semana: number;             // 1–53
  anio: number;
  disciplina: "INST" | "MEC" | "ELEC" | "GENERAL";
  areaCodigo?: string;        // null = todas las áreas de la disciplina
  fechaInicio: Date;
  fechaFin: Date;
  hhDisponiblesSemana: number;
  hhProgramadasSemana: number;
  hhReactivoSemana: number;
  personal: IPersonalSemanal[];
  otsProgramadas: IOTProgramada[];
  resumenDias: IResumenDia[];
  estado: "borrador" | "publicado" | "cerrado";
  subidoPor: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: patrones (§2.9.5) ─────────────────────────────────────────────
export interface IPatron {
  _id?: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  fechaUltimaCalibracion: Date;
  fechaVencimiento: Date;
  frecuenciaCalibracion: string;
  rangoMin?: number;
  rangoMax?: number;
  precision?: string;
  ubicacion?: string;
  responsable?: string;
  certificadoUrl?: string;
  activo: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: registros_calibracion (§2.10) ─────────────────────────────────
export interface IPuntoCalibracion {
  lecturaPatron: number;
  lecturaAntesInstrumento?: number;
  lecturaInstrumento: number;
  error: number;
  tolerancia: number;
  aprueba: boolean;
  incertidumbre?: number;       // U expandida k=2
  incertidumbrePatron?: number; // u declarada del patrón
}

export interface IRegistroCalibracion {
  _id?: string;
  numeroCertificado: string;
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  unidad?: string;
  patronId?: string;            // legado (1 patrón)
  patronCodigo?: string;        // legado
  patronIds?: string[];         // multi-patrón
  patronCodigos?: string[];     // multi-patrón
  tecnicoId: string;
  tecnicoNombre: string;
  supervisorId?: string;
  supervisorNombre?: string;
  fecha: Date;
  turno?: string;
  temperatura?: number;
  humedad?: number;
  puntos: IPuntoCalibracion[];
  puntosAntes?: IPuntoCalibracion[];
  resultadoGeneral: "APROBADO" | "RECHAZADO" | "AJUSTADO";
  observaciones?: string;
  pdfUrl?: string;
  stickerImpreso: boolean;
  otAsociada?: string;
  areaCodigo: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: planes_mantenimiento (§2.9.4) ─────────────────────────────────
export interface ITareaPlan {
  tag: string;
  descripcionTarea: string;
  horasEstimadas: number;
  diaPreferido?: string;
  herramientas?: string[];
  repuestos?: string[];
  procedimiento?: string;
}

export interface IPlanMantenimiento {
  _id?: string;
  codigo: string;
  descripcion: string;
  frecuencia: "Semanal" | "Quincenal" | "Mensual" | "Trimestral" | "Anual";
  disciplina: "MEC" | "ELEC" | "INST" | "GENERAL";
  tareas: ITareaPlan[];
  activo: boolean;
  creadoPor: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Colección: repuestos (§2.9.7) ────────────────────────────────────────────
export interface IRepuesto {
  _id?: string;
  codigo: string;
  descripcion: string;
  tipo: "Eléctrico" | "Mecánico" | "Instrumentación" | "General";
  stockMinimo: number;
  stockActual: number;
  ubicacion: string;
  precio?: number;
  activo: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
