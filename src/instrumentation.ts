/**
 * Hook de arranque de Next. Sincroniza el catálogo de áreas desde el IAM
 * al iniciar el servidor (best-effort: no bloquea el arranque si el IAM no
 * responde). También se puede forzar manualmente vía POST /api/areas/sync.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { syncAreasFromIam } = await import("@/lib/sync-areas");
      const r = await syncAreasFromIam();
      if (r.error) console.warn("[startup] Sync áreas: ", r.error);
      else console.log(`[startup] Áreas sincronizadas desde IAM: ${r.synced}`);
    } catch (e) {
      console.warn("[startup] No se pudo sincronizar áreas:", (e as Error).message);
    }
  }
}
