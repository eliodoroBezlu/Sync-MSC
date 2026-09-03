// Esquemas Zod y helpers compartidos por las rutas API de Parada de Planta.
import { z } from "zod";

export function serialize<T extends { id: string }>(o: T): T & { _id: string } {
  return { ...o, _id: o.id };
}

export function zodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("; ");
}

// ── Fechas ─────────────────────────────────────────────────────────────────
const fechaReq = z.preprocess(
  (v) => (v instanceof Date ? v : new Date(String(v))),
  z.date({ error: "fecha inválida" }),
);
const fechaNul = z.preprocess(
  (v) => (v == null || v === "" ? null : v instanceof Date ? v : new Date(String(v))),
  z.date({ error: "fecha inválida" }).nullable(),
);

const DISCIPLINA = z.enum(["ELEC", "INST", "TESA"]);
const DISCIPLINA_GRUPO = z.enum(["ELEC", "INST", "TESA", "MIXTO"]);
const FASE = z.enum(["preparativos", "ejecucion"]);
const TURNO = z.enum(["Dia", "Noche"]);
const GRUPO_OT = z.enum(["Dia", "Noche", "Ambos"]);
const ESTADO_OT = z.enum([
  "no_iniciada",
  "en_ejecucion",
  "terminada",
  "con_retraso",
]);
const REUNION = z.enum(["08:00", "17:00"]);

// ── Parada (encabezado) ────────────────────────────────────────────────────
export const crearParadaSchema = z.object({
  codigo: z.string().trim().min(1, "código requerido"),
  nombre: z.string().trim().min(1, "nombre requerido"),
  planta: z.string().trim().nullish(),
  fechaPreparativosInicio: fechaReq,
  fechaEjecucionInicio: fechaReq,
  fechaEjecucionFin: fechaReq,
  creadoPor: z.string().trim().min(1, "creadoPor requerido"),
});

export const editarParadaSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  planta: z.string().trim().nullish(),
  fechaPreparativosInicio: fechaReq.optional(),
  fechaEjecucionInicio: fechaReq.optional(),
  fechaEjecucionFin: fechaReq.optional(),
  estado: z.enum(["preparativos", "ejecucion", "cerrada"]).optional(),
  fechaCierre: fechaNul.optional(),
  leccionesAprendidas: z.string().trim().nullish(),
  observacionesCierre: z.string().trim().nullish(),
});

// ── OTs de la parada ───────────────────────────────────────────────────────
const nombresList = z.array(z.string().trim()).optional();
const idsList = z.array(z.string().trim()).optional();

export const crearOtSchema = z.object({
  numeroOT: z.string().trim().min(1, "N° OT requerido"),
  descripcion: z.string().trim().min(1, "descripción requerida"),
  tag: z.string().trim().optional().default(""),
  descripcionEquipo: z.string().trim().optional().default(""),
  disciplina: DISCIPLINA,
  fase: FASE.optional().default("ejecucion"),
  hhEstimadas: z.coerce.number().min(0).optional().default(0),
  fechaProg: fechaNul.optional(),
  fechaProgFin: fechaNul.optional(),
  grupo: GRUPO_OT.optional().default("Dia"),
  responsable: z.string().trim().nullish(),
  critica: z.boolean().optional().default(false),
  observaciones: z.string().trim().nullish(),
  orden: z.coerce.number().int().nullish(),
  personalAsignado: nombresList,
  personalAsignadoIds: idsList,
});

export const editarOtSchema = z.object({
  numeroOT: z.string().trim().min(1).optional(),
  descripcion: z.string().trim().min(1).optional(),
  tag: z.string().trim().optional(),
  descripcionEquipo: z.string().trim().optional(),
  disciplina: DISCIPLINA.optional(),
  fase: FASE.optional(),
  hhEstimadas: z.coerce.number().min(0).optional(),
  fechaProg: fechaNul.optional(),
  fechaProgFin: fechaNul.optional(),
  grupo: GRUPO_OT.optional(),
  responsable: z.string().trim().nullish(),
  critica: z.boolean().optional(),
  estado: ESTADO_OT.optional(),
  avancePct: z.coerce.number().int().min(0).max(100).optional(),
  observaciones: z.string().trim().nullish(),
  orden: z.coerce.number().int().nullish(),
  personalAsignado: nombresList,
  personalAsignadoIds: idsList,
});

// ── Grupos Día/Noche ───────────────────────────────────────────────────────
const miembroGrupoSchema = z.object({
  usuarioId: z.string().trim().nullish(),
  nombre: z.string().trim().min(1, "nombre requerido"),
  esLider: z.boolean().optional().default(false),
});

export const crearGrupoSchema = z.object({
  turno: TURNO,
  disciplina: DISCIPLINA_GRUPO,
  supervisorNombre: z.string().trim().optional().default(""),
  supervisorUsuarioId: z.string().trim().nullish(),
  dotacionPropia: z.coerce.number().int().min(0).optional().default(0),
  dotacionApoyo: z.coerce.number().int().min(0).optional().default(0),
  // Si viene, reemplaza el roster completo del grupo.
  miembros: z.array(miembroGrupoSchema).optional(),
});

export const editarGrupoSchema = z.object({
  supervisorNombre: z.string().trim().optional(),
  supervisorUsuarioId: z.string().trim().nullish(),
  dotacionPropia: z.coerce.number().int().min(0).optional(),
  dotacionApoyo: z.coerce.number().int().min(0).optional(),
});

// ── Avance diario (upsert) ─────────────────────────────────────────────────
export const avanceSchema = z.object({
  paradaOtId: z.string().trim().min(1, "paradaOtId requerido"),
  fecha: fechaReq,
  turno: TURNO,
  avancePct: z.coerce.number().int().min(0).max(100).optional().default(0),
  hhPropias: z.coerce.number().min(0).optional().default(0),
  hhApoyo: z.coerce.number().min(0).optional().default(0),
  estado: ESTADO_OT,
  comentario: z.string().trim().nullish(),
  registradoPor: z.string().trim().min(1, "registradoPor requerido"),
});

export const avancesBatchSchema = z.union([
  avanceSchema,
  z.object({ items: z.array(avanceSchema).min(1) }),
]);

// ── Reporte diario del supervisor ──────────────────────────────────────────
export const crearReporteSchema = z.object({
  fecha: fechaReq,
  turno: TURNO,
  reunion: REUNION,
  supervisorNombre: z.string().trim().min(1, "supervisor requerido"),
  supervisorUsuarioId: z.string().trim().nullish(),
  resumen: z.string().trim().optional().default(""),
  observaciones: z.string().trim().nullish(),
  prellenar: z.boolean().optional().default(false),
});

const otRetraso = z.object({
  numeroOT: z.string(),
  motivo: z.string().optional().default(""),
  accion: z.string().optional().default(""),
});
const pendiente = z.object({
  tipo: z
    .enum(["material", "repuesto", "permiso", "apoyo", "otro"])
    .optional()
    .default("otro"),
  detalle: z.string(),
});

export const editarReporteSchema = z.object({
  resumen: z.string().trim().optional(),
  avanceGlobalPct: z.coerce.number().int().min(0).max(100).optional(),
  hhPropias: z.coerce.number().min(0).optional(),
  hhApoyo: z.coerce.number().min(0).optional(),
  otsTerminadas: z.array(z.string()).optional(),
  otsConRetraso: z.array(otRetraso).optional(),
  pendientes: z.array(pendiente).optional(),
  observaciones: z.string().trim().nullish(),
  estado: z.enum(["borrador", "emitido"]).optional(),
  pdfUrl: z.string().trim().nullish(),
});

// ── Import de listado de OTs (parser flexible por nombre de columna) ────────
export const importarFilaSchema = z.object({
  numeroOT: z.string().trim().min(1),
  descripcion: z.string().trim().optional().default(""),
  tag: z.string().trim().optional().default(""),
  descripcionEquipo: z.string().trim().optional().default(""),
  disciplina: z.string().trim().optional().default(""),
  fase: z.string().trim().optional().default(""),
  hhEstimadas: z.coerce.number().min(0).optional().default(0),
  fechaProg: z.string().trim().optional().default(""),
  fechaProgFin: z.string().trim().optional().default(""),
  grupo: z.string().trim().optional().default(""),
  responsable: z.string().trim().optional().default(""),
  critica: z.union([z.boolean(), z.string()]).optional().default(false),
});

export const importarJsonSchema = z.object({
  filas: z.array(importarFilaSchema).min(1),
});
