import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "sync-msc-secret-dev-2025";
const COOKIE_NAME = "sync_session";

// Rutas de API que NO requieren sesión
const PUBLIC_API = [
  "/api/auth/login",      // inicia el flujo OIDC
  "/api/auth/callback",   // recibe el code del IdP (aún sin sesión)
  "/api/auth/logout",
  "/api/auth/me",         // valida la propia sesión (responde 401 si no hay)
  "/api/health",
  "/api/admin",
];

// Páginas públicas (sin sesión)
const PUBLIC_PAGES = ["/", "/login"];

async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(COOKIE_NAME)?.value;

  // ── Rutas de API ──────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();
    if (await isValidSession(token)) return NextResponse.next();
    return NextResponse.json(
      { ok: false, error: "No autenticado" },
      { status: 401 },
    );
  }

  // ── Páginas ───────────────────────────────────────────────────
  const isPublicPage = PUBLIC_PAGES.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
  const authed = await isValidSession(token);

  // Con sesión en "/" o "/login" → ir al dashboard
  if (authed && (pathname === "/" || pathname === "/login")) {
    return NextResponse.redirect(new URL("/inicio", req.url));
  }

  if (isPublicPage) return NextResponse.next();

  // Página protegida sin sesión → iniciar login OIDC con retorno al destino
  if (!authed) {
    const url = new URL("/api/auth/login", req.url);
    url.searchParams.set("redirect", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
