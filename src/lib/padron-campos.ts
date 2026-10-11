/**
 * Qué datos de una persona define el IAM y cuáles son propios de Sync.
 *
 * Módulo puro (sin imports de servidor): lo usan tanto la API como la pantalla
 * de Configuración, para que ambas bloqueen exactamente los mismos campos.
 *
 * Una persona puede estar, a la vez:
 *  - en el PADRÓN del IAM (trabajadorId): su identidad vive en el IAM.
 *  - con CUENTA en el IAM (tieneCuentaIam): esa identidad solo se edita en el
 *    IAM Portal. Sin cuenta, Sync la edita a través de la API del IAM.
 *  - USANDO Sync con su cuenta (iamUserId): además, el login OIDC le fija rol,
 *    áreas, email y estado en cada inicio de sesión.
 */

/** Identidad de la persona: vive en el Trabajador del IAM. */
export const CAMPOS_TRABAJADOR = [
  "nombre", "jde", "puesto", "superintendencia", "areaTrabajo",
  "disciplina", "esContratista", "celular", "activo",
] as const;

/** Lo que el login OIDC sobrescribe (ver api/auth/callback). */
export const CAMPOS_LOGIN = [
  "nombre", "email", "rol", "disciplina", "jde", "puesto",
  "superintendencia", "areaTrabajo", "activo", "areas",
] as const;

export type CampoPersona =
  | (typeof CAMPOS_TRABAJADOR)[number]
  | (typeof CAMPOS_LOGIN)[number];

export const ETIQUETAS: Record<CampoPersona, string> = {
  nombre: "nómina",
  email: "email",
  rol: "rol",
  disciplina: "disciplina",
  jde: "JDE",
  puesto: "puesto",
  superintendencia: "superintendencia",
  areaTrabajo: "área de trabajo",
  activo: "estado activo/inactivo",
  areas: "áreas asignadas",
  esContratista: "condición de contratista",
  celular: "celular",
};

export interface GestionPersona {
  /** Entra a Sync con su cuenta del IAM (el login le fija rol, áreas…). */
  usaSync: boolean;
  /** Tiene cuenta en el IAM: su identidad se edita solo en el portal. */
  cuentaIam: boolean;
  /** Está enlazada al padrón del IAM. */
  enPadron: boolean;
}

/** Campos que el IAM define para esta persona y que Sync NO puede cambiar. */
export function camposDelIam(g: GestionPersona): Set<CampoPersona> {
  const s = new Set<CampoPersona>();
  if (g.usaSync) CAMPOS_LOGIN.forEach((c) => s.add(c));
  if (g.cuentaIam && g.enPadron) CAMPOS_TRABAJADOR.forEach((c) => s.add(c));
  return s;
}

/** ¿Los cambios de identidad de esta persona se envían al padrón del IAM? */
export function identidadViaIam(g: GestionPersona): boolean {
  return !g.cuentaIam && !g.usaSync;
}
