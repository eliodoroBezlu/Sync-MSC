/**
 * Reglas para gestionar personas en Sync ahora que el acceso está centralizado
 * en el IAM.
 *
 * Una fila `Usuario` con `iamUserId` está VINCULADA a una cuenta del IAM: en
 * cada inicio de sesión, el callback OIDC (api/auth/callback) sobrescribe sus
 * datos de identidad con los del IAM. Editarlos en Sync no dura —se pierden en
 * el siguiente login—, así que se rechaza en vez de aceptarlo en silencio.
 *
 * Las filas SIN `iamUserId` son personas operativas (técnicos a los que se les
 * asigna trabajo pero que no inician sesión) y se siguen gestionando aquí.
 *
 * Las contraseñas no existen en Sync: el login es OIDC contra el IAM.
 */
import type { Prisma } from "@prisma/client";

/**
 * Campos que el callback OIDC sobrescribe en cada login, con su nombre legible.
 * Mantener en sincronía con el objeto `data` de api/auth/callback/route.ts.
 */
const CAMPOS_IAM = {
  nombre: "nómina",
  email: "email",
  rol: "rol",
  disciplina: "disciplina",
  jde: "JDE",
  puesto: "puesto",
  superintendencia: "superintendencia",
  areaTrabajo: "área de trabajo",
  activo: "estado activo/inactivo",
} as const;
type CampoIam = keyof typeof CAMPOS_IAM;

const ETIQUETA_AREAS = "áreas asignadas";

/** Lo mínimo que estas reglas necesitan de la fila actual. */
export interface UsuarioActual {
  iamUserId: string | null;
  nombre: string;
  email: string | null;
  rol: number;
  disciplina: string;
  jde: string | null;
  puesto: string | null;
  superintendencia: string | null;
  areaTrabajo: string | null;
  activo: boolean;
  areas: { areaCodigo: string }[];
}

export const MSG_CONTRASENA =
  "Las contraseñas ya no se gestionan en Sync: cada persona cambia la suya en «Mi cuenta» " +
  "(IAM Portal) y un administrador puede restablecerla en IAM Portal → Usuarios.";

export const MSG_ELIMINAR_VINCULADO =
  "Esta persona inicia sesión con su cuenta del IAM. Para quitarle el acceso a Sync, revócalo " +
  "en IAM Portal → Usuarios → Gestionar servicios. Si la eliminas aquí, se vuelve a crear en " +
  "su próximo inicio de sesión y pierde el vínculo con su historial.";

/** ¿El cuerpo intenta fijar una contraseña? Un `password` vacío se ignora. */
export function traeContrasena(body: Record<string, unknown>): boolean {
  return (
    (typeof body.password === "string" && body.password.trim() !== "") ||
    body.passwordHash !== undefined
  );
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Misma forma en que se guarda cada campo, para comparar sin falsos cambios. */
function normalizar(campo: CampoIam, v: unknown): string | number | boolean | null {
  switch (campo) {
    case "rol": {
      const n = Number(v);
      return v === null || v === undefined || v === "" || Number.isNaN(n) ? null : n;
    }
    case "activo":
      return v === true || v === "true";
    case "email":
      return texto(v)?.toLowerCase() ?? null;
    case "jde":
      return texto(v)?.replace(/\.0+$/, "") ?? null;
    default:
      return texto(v);
  }
}

/**
 * Campos gestionados por el IAM que el cuerpo intenta CAMBIAR (no basta con que
 * vengan: el formulario de edición los reenvía sin tocar). Devuelve sus nombres
 * legibles; vacío si no hay cambios.
 */
export function camposIamModificados(
  actual: UsuarioActual,
  body: Record<string, unknown>,
): string[] {
  const cambios: string[] = [];
  for (const campo of Object.keys(CAMPOS_IAM) as CampoIam[]) {
    if (body[campo] === undefined) continue;
    if (normalizar(campo, body[campo]) !== normalizar(campo, actual[campo])) {
      cambios.push(CAMPOS_IAM[campo]);
    }
  }
  if (Array.isArray(body.areas)) {
    const nuevas = [...new Set(body.areas.map(String))].sort().join(",");
    const actuales = actual.areas.map((a) => a.areaCodigo).sort().join(",");
    if (nuevas !== actuales) cambios.push(ETIQUETA_AREAS);
  }
  return cambios;
}

function enumerar(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function mensajeCamposIam(cambios: string[]): string {
  const base =
    `Esta persona inicia sesión con su cuenta del IAM, que define estos datos: ${enumerar(cambios)}. ` +
    "Si lo cambias aquí, se sobrescribe en su próximo inicio de sesión: hazlo en IAM Portal → Usuarios.";
  return cambios.includes(CAMPOS_IAM.activo)
    ? `${base} Para quitarle el acceso a Sync, revócalo allí en «Gestionar servicios».`
    : base;
}

/**
 * Datos a guardar en una edición, a partir de una lista blanca de campos (el
 * cuerpo nunca puede fijar `iamUserId`, `passwordHash`, `id`, etc.).
 * Si la persona está vinculada al IAM, solo se guardan los campos propios de
 * Sync, que el IAM no toca.
 */
export function datosEditables(
  body: Record<string, unknown>,
  vinculado: boolean,
): Prisma.UsuarioUpdateInput {
  const data: Prisma.UsuarioUpdateInput = {};
  const viene = (k: string) => body[k] !== undefined;

  // Propios de Sync: siempre editables
  if (viene("apellido")) data.apellido = texto(body.apellido);
  if (viene("celular")) data.celular = texto(body.celular);
  if (viene("esContratista")) data.esContratista = body.esContratista === true;
  if (viene("fechaExpiracion")) {
    data.fechaExpiracion = body.fechaExpiracion ? new Date(String(body.fechaExpiracion)) : null;
  }
  if (vinculado) return data;

  // Identidad: solo para personas sin cuenta en el IAM
  const nombre = texto(body.nombre);
  if (nombre) data.nombre = nombre;
  if (viene("email")) data.email = normalizar("email", body.email) as string | null;
  const rol = normalizar("rol", body.rol);
  if (typeof rol === "number") data.rol = rol;
  if (viene("disciplina")) data.disciplina = texto(body.disciplina) ?? "GENERAL";
  if (viene("jde")) data.jde = normalizar("jde", body.jde) as string | null;
  if (viene("puesto")) data.puesto = texto(body.puesto);
  if (viene("superintendencia")) data.superintendencia = texto(body.superintendencia);
  if (viene("areaTrabajo")) data.areaTrabajo = texto(body.areaTrabajo);
  if (viene("activo")) data.activo = normalizar("activo", body.activo) as boolean;
  return data;
}
