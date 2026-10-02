/**
 * Hook de arranque de Next. Al iniciar el servidor sincroniza desde el IAM
 * (best-effort: no bloquea el arranque si el IAM no responde):
 *  1. el catálogo de áreas           (manual: POST /api/areas/sync)
 *  2. la identidad del padrón de personas (manual: POST /api/padron/sync)
 * Las áreas van primero: el padrón traduce nombres de área a sus códigos.
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

    try {
      const { refrescarPadron } = await import("@/lib/padron");
      const r = await refrescarPadron();
      console.log(
        `[startup] Padrón desde IAM: ${r.refrescados} actualizadas, ${r.enlazados} enlazadas, ` +
          `${r.sinPar.length} sin par en el IAM, ${r.conflictos.length} conflictos`,
      );
    } catch (e) {
      console.warn("[startup] No se pudo sincronizar el padrón:", (e as Error).message);
    }
  }
}
