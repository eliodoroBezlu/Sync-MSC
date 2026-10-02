/**
 * Cliente del padrón de trabajadores del IAM (service-to-service, X-Api-Key).
 * Solo servidor: la API key nunca llega al navegador.
 *
 *   IAM_API_KEY  → API key del servicio sync-msc (IAM Portal → Admin → API keys)
 *   IAM_API_URL  → base de la API del IAM; por defecto IAM_CORE_PUBLIC_URL
 *                  (en prod, el proxy del portal: https://<portal>/api/iam)
 */

/** Trabajador tal como lo entrega el IAM (GET/POST/PATCH /rbac/trabajadores). */
export interface TrabajadorIam {
  id: string;
  ci: string | null;
  nomina: string;
  puesto: string;
  superintendencia: string;
  area: string | null;
  areaCodigo: string | null;
  jde: string | null;
  disciplina: string | null;
  esContratista: boolean;
  celular: string | null;
  activo: boolean;
  tieneAccesoSistema: boolean;
  /** Cuenta del IAM vinculada (sus datos se gestionan en el portal). */
  userId: string | null;
  username: string | null;
}

/** Datos que Sync puede enviar al crear/editar un trabajador. */
export interface DatosTrabajador {
  nomina?: string;
  puesto?: string;
  jde?: string;
  areaCodigo?: string;
  area?: string;
  superintendencia?: string;
  disciplina?: string;
  esContratista?: boolean;
  celular?: string;
  activo?: boolean;
}

/** Lo que Sync puede aportar a una ficha del IAM que lo tiene vacío. */
export interface DatosCompletar {
  jde?: string;
  disciplina?: string;
  celular?: string;
  areaCodigo?: string;
}

/** Usuario de Sync que origina el cambio (queda en la auditoría del IAM). */
export interface ActorIam {
  id?: string | null;
  nombre?: string | null;
}

/** El IAM no respondió (red, timeout, 5xx) o falta configuración: reintentar. */
export class IamNoDisponible extends Error {}

/** El IAM respondió con un rechazo (4xx): su mensaje explica el motivo. */
export class IamRechazo extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

function base(): string {
  return (process.env.IAM_API_URL || process.env.IAM_CORE_PUBLIC_URL || "http://localhost:4000/api")
    .trim()
    .replace(/\/+$/, "");
}

function mensajeDe(body: unknown, status: number): string {
  const b = body as { error?: unknown; message?: unknown } | null;
  const m = b?.error ?? b?.message;
  if (Array.isArray(m)) return m.join(". ");
  if (typeof m === "string" && m) return m;
  return `El IAM rechazó la operación (${status})`;
}

async function llamar<T>(path: string, init: RequestInit, actor?: ActorIam): Promise<T> {
  const apiKey = process.env.IAM_API_KEY?.trim();
  if (!apiKey) {
    throw new IamNoDisponible("Falta IAM_API_KEY: Sync no puede comunicarse con el padrón del IAM.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
  };
  if (actor?.id) headers["X-Actor-Id"] = actor.id;
  if (actor?.nombre) headers["X-Actor-Nombre"] = encodeURIComponent(actor.nombre);

  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new IamNoDisponible(`No se pudo contactar al IAM: ${(e as Error).message}`);
  }

  const body: unknown = await res.json().catch(() => null);
  if (res.status >= 500) throw new IamNoDisponible(`El IAM respondió ${res.status}`);
  if (!res.ok) throw new IamRechazo(mensajeDe(body, res.status), res.status);
  return body as T;
}

export async function listarTrabajadores(): Promise<TrabajadorIam[]> {
  const r = await llamar<{ trabajadores?: TrabajadorIam[] }>("/rbac/trabajadores", { method: "GET" });
  return r.trabajadores ?? [];
}

/** Alta idempotente: si ya existe alguien con el mismo CI/JDE, devuelve ese (creado: false). */
export async function crearTrabajador(
  datos: DatosTrabajador,
  actor?: ActorIam,
): Promise<{ trabajador: TrabajadorIam; creado: boolean }> {
  return llamar("/rbac/trabajadores", { method: "POST", body: JSON.stringify(datos) }, actor);
}

/** Solo para trabajadores SIN cuenta del IAM (los demás → 409, se editan en el portal). */
export async function actualizarTrabajador(
  id: string,
  datos: DatosTrabajador,
  actor?: ActorIam,
): Promise<TrabajadorIam> {
  const r = await llamar<{ trabajador: TrabajadorIam }>(
    `/rbac/trabajadores/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(datos) },
    actor,
  );
  return r.trabajador;
}

/**
 * Rellena solo los campos VACÍOS de la ficha (con o sin cuenta); nunca pisa un
 * dato del IAM. `omitidos` explica lo que no se copió (p. ej. JDE ya en uso).
 */
export async function completarTrabajador(
  id: string,
  datos: DatosCompletar,
  actor?: ActorIam,
): Promise<{ trabajador: TrabajadorIam; completados: string[]; omitidos: string[] }> {
  return llamar(
    `/rbac/trabajadores/${encodeURIComponent(id)}/completar`,
    { method: "POST", body: JSON.stringify(datos) },
    actor,
  );
}
