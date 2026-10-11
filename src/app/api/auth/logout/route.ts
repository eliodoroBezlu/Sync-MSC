// app/api/auth/logout/route.ts
// Cierre de sesión completo: borra la sesión local de Sync y termina la sesión
// SSO del IAM (RP-initiated logout). Borrar solo sync_session no basta: el IAM
// seguiría con sesión y /authorize volvería a entrar sin pedir credenciales.
//
// Debe abrirse como navegación del navegador (no fetch) para que el IAM pueda
// limpiar sus cookies en el dominio del portal y redirigir de vuelta a Sync.
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import {
  getOidcClient,
  OIDC_POST_LOGOUT_REDIRECT_URI,
  ID_TOKEN_COOKIE,
} from "@/lib/oidc";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const idToken = request.cookies.get(ID_TOKEN_COOKIE)?.value;

  // Sin id_token (sesiones abiertas antes de guardarlo) el IAM igual cierra el
  // SSO, pero deja al usuario en el login del portal en vez de volver a Sync.
  const endSessionUrl = getOidcClient().endSessionUrl({
    post_logout_redirect_uri: OIDC_POST_LOGOUT_REDIRECT_URI,
    ...(idToken ? { id_token_hint: idToken } : {}),
  });

  const res = NextResponse.redirect(endSessionUrl);
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  res.cookies.set(ID_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
