/**
 * URL pública del IAM Portal (donde se gestionan cuentas, contraseñas y accesos).
 *
 * Se resuelve en el servidor en tiempo de ejecución, no con NEXT_PUBLIC_*: el
 * Dockerfile no pasa variables al build y quedaría vacía en producción.
 *   1. IAM_PORTAL_URL, si está definida.
 *   2. Derivada de IAM_CORE_PUBLIC_URL cuando apunta al proxy del portal
 *      (https://<portal>/api/iam → https://<portal>), que es el caso en prod.
 */
export function getIamPortalUrl(): string | null {
  const explicita = process.env.IAM_PORTAL_URL?.trim();
  if (explicita) return explicita.replace(/\/+$/, "");

  const core = (process.env.IAM_CORE_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  const SUFIJO_PROXY = "/api/iam";
  return core.endsWith(SUFIJO_PROXY) ? core.slice(0, -SUFIJO_PROXY.length) : null;
}

/** Destinos permitidos dentro del portal (lista cerrada: evita open redirect). */
export const DESTINOS_PORTAL = {
  perfil: "/dashboard/profile",
  admin: "/dashboard/admin",
} as const;
export type DestinoPortal = keyof typeof DESTINOS_PORTAL;

export function esDestinoPortal(v: string | null): v is DestinoPortal {
  // hasOwn, no `in`: `"constructor" in obj` también es true.
  return v !== null && Object.hasOwn(DESTINOS_PORTAL, v);
}
