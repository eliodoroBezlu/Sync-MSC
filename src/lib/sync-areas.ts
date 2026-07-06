/**
 * Sincroniza el catálogo de áreas desde el IAM (fuente de verdad) hacia la
 * tabla Area local de Sync — necesaria por las FKs con equipos/OTs.
 *
 * Hace UPSERT de código/nombre/superintendencia SIN pisar la config privada
 * de Sync (`tieneCalibracion`, `activo`). El IAM se consulta en:
 *   ${IAM_CORE_PUBLIC_URL}/rbac/catalog/areas
 */
import { prisma } from "@/lib/prisma";

const IAM_CORE_PUBLIC_URL = (
  process.env.IAM_CORE_PUBLIC_URL || "http://localhost:4000/api"
).replace(/\/+$/, "");

interface CatalogArea {
  codigo: string;
  nombre: string;
  superintendencia: string;
}

export async function syncAreasFromIam(): Promise<{ synced: number; error?: string }> {
  try {
    const res = await fetch(`${IAM_CORE_PUBLIC_URL}/rbac/catalog/areas`, {
      cache: "no-store",
    });
    if (!res.ok) return { synced: 0, error: `IAM respondió ${res.status}` };

    const data = (await res.json()) as { areas?: CatalogArea[] };
    const areas = data.areas ?? [];

    let synced = 0;
    for (const a of areas) {
      if (!a.codigo) continue;
      await prisma.area.upsert({
        where:  { codigo: a.codigo },
        // NO tocar tieneCalibracion ni activo (config privada de Sync)
        update: { nombre: a.nombre, superintendencia: a.superintendencia },
        create: { codigo: a.codigo, nombre: a.nombre, superintendencia: a.superintendencia },
      });
      synced++;
    }
    return { synced };
  } catch (e) {
    return { synced: 0, error: (e as Error).message };
  }
}
