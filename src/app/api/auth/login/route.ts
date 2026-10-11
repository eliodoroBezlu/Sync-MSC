// app/api/auth/login/route.ts
// Inicio del flujo OIDC Authorization Code + PKCE contra el IAM.
// Genera code_verifier/state/nonce, los guarda en una cookie corta (oidc_tx)
// y redirige al endpoint /authorize del IdP (vía proxy del portal en prod).
import { NextRequest, NextResponse } from "next/server";
import { getOidcClient, generators } from "@/lib/oidc";
import { getPublicOrigin } from "@/lib/public-url";

export const runtime = "nodejs";

const TX_COOKIE = "oidc_tx";

/** Acepta solo destinos same-origin para evitar open-redirect. */
function safeRedirect(raw: string | null, request: NextRequest): string {
  if (!raw) return "/inicio";
  try {
    if (raw.startsWith("/")) return raw;
    const url = new URL(raw);
    if (url.origin === getPublicOrigin(request)) return url.pathname + url.search;
  } catch {
    /* ignore */
  }
  return "/inicio";
}

export async function GET(request: NextRequest) {
  const client = getOidcClient();

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  const redirect = safeRedirect(
    request.nextUrl.searchParams.get("redirect"),
    request,
  );

  const authUrl = client.authorizationUrl({
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(TX_COOKIE, JSON.stringify({ codeVerifier, state, nonce, redirect }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min para completar el login
  });
  return res;
}
