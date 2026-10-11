/**
 * Resuelve el origen PÚBLICO de Sync-MSC para construir redirects.
 *
 * Detrás de un proxy (Railway, etc.) `request.nextUrl.origin` apunta al host
 * interno del contenedor (ej. http://localhost:3000), no a la URL pública.
 * Usar ese origin en un redirect manda al usuario a "localhost". Por eso:
 *   1. NEXT_PUBLIC_APP_URL  → valor de confianza configurado (preferido)
 *   2. x-forwarded-host / host → cabecera del proxy (fallback)
 *   3. request.nextUrl.origin  → último recurso (dev local sin proxy)
 */
import type { NextRequest } from "next/server";

export function getPublicOrigin(request: NextRequest): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl.replace(/\/+$/, "");

  const fwdHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (fwdHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${fwdHost}`;
  }

  return request.nextUrl.origin;
}
