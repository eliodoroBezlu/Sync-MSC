import { SessionPayload } from "@/lib/auth";

export type AreaScope = { allAreas: true } | { allAreas: false; areas: string[] };

// Espeja el filtrado por área que ya usa src/app/ordenes/reporte/page.tsx en el
// cliente (rol 3 con áreas asignadas ⇒ solo esas áreas), pero como fuente de
// verdad server-side: Admin (1), Superintendente (2) y Planificador (5) ven
// todas las áreas; Supervisor (3), Técnico (4) y Contratista (6) quedan
// acotados a session.areas. Un rol acotado sin áreas asignadas nunca cae a
// "todas" — se trata como alcance vacío para no filtrar en falso abierto.
export function resolveAreaScope(session: SessionPayload): AreaScope {
  if (session.rol === 1 || session.rol === 2 || session.rol === 5) {
    return { allAreas: true };
  }
  return { allAreas: false, areas: session.areas ?? [] };
}

export function scopeWhereAreaCodigo(scope: AreaScope): { areaCodigo?: { in: string[] } } {
  if (scope.allAreas) return {};
  return { areaCodigo: { in: scope.areas } };
}
