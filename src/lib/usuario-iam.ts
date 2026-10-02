/**
 * Reglas de edición de personas en Sync con la identidad centralizada en el IAM.
 *
 * Qué define el IAM para cada persona lo decide `padron-campos.ts`:
 *  - Si entra a Sync con su cuenta, el login le fija rol, áreas, email y estado.
 *  - Si tiene cuenta en el IAM, su identidad solo se edita en el IAM Portal.
 *  - Si solo está en el padrón (sin cuenta), Sync edita su identidad a través
 *    de la API del IAM (ver api/usuarios/[id]).
 * Editar aquí algo que el IAM sobrescribe no duraría, así que se rechaza.
 *
 * Las contraseñas no existen en Sync: el login es OIDC contra el IAM.
 */
import type { Prisma } from "@prisma/client";
import {
  CAMPOS_TRABAJADOR,
  ETIQUETAS,
  camposDelIam,
  identidadViaIam,
  type CampoPersona,
  type GestionPersona,
} from "@/lib/padron-campos";

/** Lo mínimo que estas reglas necesitan de la fila actual. */
export interface UsuarioActual {
  nombre: string;
  email: string | null;
  rol: number;
  disciplina: string;
  jde: string | null;
  puesto: string | null;
  superintendencia: string | null;
  areaTrabajo: string | null;
  activo: boolean;
  esContratista: boolean;
  celular: string | null;
  areas: { areaCodigo: string }[];
}

export const MSG_CONTRASENA =
  "Las contraseñas ya no se gestionan en Sync: cada persona cambia la suya en «Mi cuenta» " +
  "(IAM Portal) y un administrador puede restablecerla en IAM Portal → Usuarios.";

export const MSG_ELIMINAR_VINCULADO =
  "Esta persona inicia sesión con su cuenta del IAM. Para quitarle el acceso a Sync, revócalo " +
  "en IAM Portal → Usuarios → Gestionar servicios. Si la eliminas aquí, se vuelve a crear en " +
  "su próximo inicio de sesión y pierde el vínculo con su historial.";

export const MSG_IAM_NO_DISPONIBLE =
  "El IAM no está disponible en este momento, así que no se guardó ningún cambio. " +
  "Intenta de nuevo en unos minutos.";

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
function normalizar(campo: Exclude<CampoPersona, "areas">, v: unknown): string | number | boolean | null {
  switch (campo) {
    case "rol": {
      const n = Number(v);
      return v === null || v === undefined || v === "" || Number.isNaN(n) ? null : n;
    }
    case "activo":
    case "esContratista":
      return v === true || v === "true";
    case "email":
      return texto(v)?.toLowerCase() ?? null;
    case "jde":
      return texto(v)?.replace(/\.0+$/, "") ?? null;
    case "disciplina":
      return texto(v) ?? "GENERAL";
    default:
      return texto(v);
  }
}

/**
 * Campos (de los indicados) que el cuerpo intenta CAMBIAR. No basta con que
 * vengan: el formulario de edición los reenvía sin tocar.
 */
export function camposModificados(
  actual: UsuarioActual,
  body: Record<string, unknown>,
  campos: Iterable<CampoPersona>,
): CampoPersona[] {
  const cambios: CampoPersona[] = [];
  for (const campo of campos) {
    if (body[campo] === undefined) continue;
    if (campo === "areas") {
      if (!Array.isArray(body.areas)) continue;
      const nuevas = [...new Set(body.areas.map(String))].sort().join(",");
      const actuales = actual.areas.map((a) => a.areaCodigo).sort().join(",");
      if (nuevas !== actuales) cambios.push(campo);
    } else if (normalizar(campo, body[campo]) !== normalizar(campo, actual[campo])) {
      cambios.push(campo);
    }
  }
  return cambios;
}

function enumerar(items: string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function mensajeCamposIam(cambios: CampoPersona[], g: GestionPersona): string {
  const lista = enumerar(cambios.map((c) => ETIQUETAS[c]));
  if (g.usaSync) {
    const base =
      `Esta persona inicia sesión con su cuenta del IAM, que define estos datos: ${lista}. ` +
      "Si lo cambias aquí, se sobrescribe en su próximo inicio de sesión: hazlo en IAM Portal → Usuarios.";
    return cambios.includes("activo")
      ? `${base} Para quitarle el acceso a Sync, revócalo allí en «Gestionar servicios».`
      : base;
  }
  return (
    `Esta persona tiene cuenta en el IAM, así que estos datos se editan en el IAM Portal → Trabajadores: ${lista}. ` +
    "Sync los recibe en la siguiente sincronización."
  );
}

/** Los campos de identidad que este cuerpo cambia y que van al IAM (personas sin cuenta). */
export function cambiosDeIdentidad(
  actual: UsuarioActual,
  body: Record<string, unknown>,
  g: GestionPersona,
): CampoPersona[] {
  return identidadViaIam(g) ? camposModificados(actual, body, CAMPOS_TRABAJADOR) : [];
}

/**
 * Datos que se guardan solo en Sync, desde una lista blanca de campos (el
 * cuerpo nunca puede fijar `iamUserId`, `trabajadorId`, `passwordHash`…).
 * Excluye lo que define el IAM y, para personas cuya identidad va al IAM,
 * también la identidad (se copia de la respuesta del IAM).
 */
export function datosLocales(
  body: Record<string, unknown>,
  g: GestionPersona,
): Prisma.UsuarioUpdateInput {
  const bloqueados = camposDelIam(g);
  const permitido = (c: string) => !bloqueados.has(c as CampoPersona);
  const viene = (k: string) => body[k] !== undefined && permitido(k);
  const data: Prisma.UsuarioUpdateInput = {};

  // Propios de Sync
  if (viene("apellido")) data.apellido = texto(body.apellido);
  if (viene("email")) data.email = normalizar("email", body.email) as string | null;
  const rol = normalizar("rol", body.rol);
  if (viene("rol") && typeof rol === "number") data.rol = rol;
  if (body.fechaExpiracion !== undefined) {
    data.fechaExpiracion = body.fechaExpiracion ? new Date(String(body.fechaExpiracion)) : null;
  }
  if (identidadViaIam(g)) return data;

  // Sin padrón del IAM detrás (p. ej. cuenta sin ficha de trabajador): la
  // identidad que el login no fija sigue siendo local.
  const nombre = texto(body.nombre);
  if (viene("nombre") && nombre) data.nombre = nombre;
  if (viene("jde")) data.jde = normalizar("jde", body.jde) as string | null;
  if (viene("puesto")) data.puesto = texto(body.puesto);
  if (viene("superintendencia")) data.superintendencia = texto(body.superintendencia);
  if (viene("areaTrabajo")) data.areaTrabajo = texto(body.areaTrabajo);
  if (viene("disciplina")) data.disciplina = normalizar("disciplina", body.disciplina) as string;
  if (viene("esContratista")) data.esContratista = body.esContratista === true;
  if (viene("celular")) data.celular = texto(body.celular);
  if (viene("activo")) data.activo = normalizar("activo", body.activo) as boolean;
  return data;
}
