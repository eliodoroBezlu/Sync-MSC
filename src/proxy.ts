import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "sync-msc-secret-dev-2025";
const COOKIE_NAME = "sync_session";

// Rutas que no requieren autenticación
const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/api/admin",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Solo proteger rutas /api/*
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Permitir rutas públicas
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return NextResponse.json({ ok: false, error: "Sesión inválida o expirada" }, { status: 401 });
  }
}

export const config = {
  matcher: "/api/:path*",
};
