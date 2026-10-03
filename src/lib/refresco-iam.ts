/**
 * Copia periódica desde el IAM: catálogo de áreas y luego identidad del padrón.
 *
 * Así los cambios hechos en el IAM Portal (nombre, JDE, puesto, baja…) llegan a
 * Sync sin que nadie pulse "Sincronizar". Se eligió un refresco periódico y no
 * webhooks: es una lectura idempotente y barata, y no obliga al IAM a conocer la
 * URL de cada servicio ni a reintentar envíos. Quien inicia sesión además se
 * actualiza al instante (ver api/auth/callback).
 *
 *   IAM_REFRESCO_MINUTOS  intervalo (por defecto 10; 0 lo desactiva).
 *
 * Best-effort: si el IAM no responde se avisa en el log y se reintenta en el
 * siguiente ciclo; Sync sigue funcionando con su copia.
 */
import { syncAreasFromIam } from "@/lib/sync-areas";
import { refrescarPadron } from "@/lib/padron";

const MINUTOS_POR_DEFECTO = 10;

type Estado = { timer?: ReturnType<typeof setInterval>; corriendo: boolean };
// En globalThis: un solo ciclo por proceso aunque el módulo se evalúe dos veces.
const g = globalThis as unknown as { __refrescoIam?: Estado };
const estado: Estado = (g.__refrescoIam ??= { corriendo: false });

/** Una pasada completa. `origen` solo distingue los mensajes del log. */
export async function refrescarDesdeIam(origen: "startup" | "periodico"): Promise<void> {
  if (estado.corriendo) return; // la pasada anterior aún no terminó
  estado.corriendo = true;
  const tag = `[${origen}]`;
  try {
    // Las áreas van primero: el padrón traduce nombres de área a sus códigos.
    try {
      const r = await syncAreasFromIam();
      if (r.error) console.warn(`${tag} Sync áreas:`, r.error);
      else if (origen === "startup") console.log(`${tag} Áreas sincronizadas desde IAM: ${r.synced}`);
    } catch (e) {
      console.warn(`${tag} No se pudo sincronizar áreas:`, (e as Error).message);
    }

    try {
      const r = await refrescarPadron();
      // En el ciclo periódico solo se registra lo que cambió, para no llenar el log.
      if (origen === "startup" || r.refrescados > 0) {
        console.log(`${tag} Padrón desde IAM: ${r.refrescados} actualizadas, ${r.conflictos.length} conflictos`);
      }
      // El detalle de los conflictos, solo al arrancar (persisten hasta resolverse)
      if (origen === "startup") for (const c of r.conflictos) console.warn(`${tag} Padrón — ${c.nombre}: ${c.motivo}`);
    } catch (e) {
      console.warn(`${tag} No se pudo sincronizar el padrón:`, (e as Error).message);
    }
  } finally {
    estado.corriendo = false;
  }
}

/** Arranca el ciclo (idempotente). */
export function iniciarRefrescoPeriodico(): void {
  if (estado.timer) return;
  const crudo = process.env.IAM_REFRESCO_MINUTOS?.trim();
  const minutos = crudo === undefined || crudo === "" ? MINUTOS_POR_DEFECTO : Number(crudo);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    console.log("[startup] Refresco periódico desde el IAM desactivado (IAM_REFRESCO_MINUTOS)");
    return;
  }
  estado.timer = setInterval(() => void refrescarDesdeIam("periodico"), minutos * 60_000);
  // No mantener vivo el proceso solo por este temporizador.
  estado.timer.unref?.();
  console.log(`[startup] Refresco desde el IAM cada ${minutos} min`);
}
