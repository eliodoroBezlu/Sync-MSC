/**
 * Mapeo entre la autorización centralizada del IAM y el perfil local de Sync.
 *
 * El IAM es la fuente de verdad: expone en `userinfo`
 *   - `trabajador`     → datos de la persona (nombre/nomina, jde, puesto, área, disciplina)
 *   - `service_access` → [{ serviceKey, roles, metadata }]  (roles 'sync-msc:*', áreas en metadata)
 *
 * Sync deriva de ahí su `Rol` numérico (1-6) y las áreas asignadas.
 */
import type { Rol } from "@/types";

export const SYNC_SERVICE_KEY = "sync-msc";

// sync-msc:<slug>  →  Rol numérico de Sync
const ROLE_MAP: Record<string, Rol> = {
  admin: 1,
  superintendente: 2,
  supervisor: 3,
  tecnico: 4,
  planificador: 5,
  contratista: 6,
};

export interface OidcTrabajador {
  ci?: string;
  jde?: string;
  nomina?: string;
  puesto?: string;
  area?: string;
  superintendencia?: string;
  disciplina?: string;
}

export interface OidcServiceAccess {
  serviceKey: string;
  roles: string[];
  permissions?: string[]; // permisos efectivos computados por el IAM (RBAC centralizado)
  metadata?: { areas?: string[]; disciplina?: string } | null;
}

export interface OidcUserInfo {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  roles?: string[];
  services?: string[];
  service_access?: OidcServiceAccess[];
  trabajador?: OidcTrabajador;
}

/** Acceso del usuario al servicio sync-msc (o undefined si no lo tiene). */
export function getSyncAccess(info: OidcUserInfo): OidcServiceAccess | undefined {
  return info.service_access?.find((s) => s.serviceKey === SYNC_SERVICE_KEY);
}

/** Deriva el Rol numérico de Sync desde los roles genéricos. Default: Técnico (4). */
export function mapSyncRole(roles: string[]): Rol {
  // Prioridad: el rol más alto (número más bajo) gana si hay varios.
  // Acepta roles genéricos ('supervisor') y, por compatibilidad, con prefijo.
  let best: Rol | null = null;
  for (const r of roles) {
    const slug = (r.includes(':') ? r.split(':').pop()! : r).toLowerCase();
    // super_admin mapea a admin (1) en Sync
    const mapped = slug === 'super_admin' ? 1 : ROLE_MAP[slug];
    if (mapped && (best === null || mapped < best)) best = mapped;
  }
  return best ?? 4;
}

/** Disciplina válida o GENERAL por defecto. */
export function normalizeDisciplina(
  d?: string,
): "GENERAL" | "MEC" | "ELEC" | "INST" {
  const up = (d ?? "").toUpperCase();
  return up === "MEC" || up === "ELEC" || up === "INST" ? up : "GENERAL";
}
