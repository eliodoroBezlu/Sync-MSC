/**
 * Hook de arranque de Next. Sincroniza desde el IAM al iniciar el servidor y
 * deja un refresco periódico (ver lib/refresco-iam.ts):
 *  1. el catálogo de áreas                (manual: POST /api/areas/sync)
 *  2. la identidad del padrón de personas (manual: POST /api/padron/sync)
 * Best-effort: no bloquea el arranque si el IAM no responde.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refrescarDesdeIam, iniciarRefrescoPeriodico } = await import("@/lib/refresco-iam");
    await refrescarDesdeIam("startup");
    iniciarRefrescoPeriodico();
  }
}
