import { verifyToken, COOKIE_NAME, MAX_AGE, signToken, SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Disciplina, Rol } from "@/types";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ ok: false, user: null }, { status: 401 });

  const payload = verifyToken(token);
  if (!payload) return NextResponse.json({ ok: false, user: null }, { status: 401 });

  // Releer desde la BD en cada chequeo de sesión: el JWT es un snapshot firmado
  // en el login y queda congelado hasta por 8h (MAX_AGE). Si un admin cambia el
  // rol o las áreas de este usuario mientras tiene la sesión abierta, sin esto
  // el cliente seguiría viendo permisos viejos hasta que vuelva a loguearse.
  const dbUser = await prisma.usuario.findFirst({
    where: { id: payload.id, activo: true },
    include: { areas: true },
  });
  if (!dbUser) return NextResponse.json({ ok: false, user: null }, { status: 401 });

  const fresh: SessionPayload = {
    id: dbUser.id,
    nombre: dbUser.apellido ? `${dbUser.nombre} ${dbUser.apellido}` : dbUser.nombre,
    email: dbUser.email!,
    rol: dbUser.rol as Rol,
    areas: dbUser.areas.map((a) => a.areaCodigo),
    disciplina: (dbUser.disciplina as Disciplina) ?? "GENERAL",
  };

  const res = NextResponse.json({ ok: true, user: fresh });
  res.cookies.set(COOKIE_NAME, signToken(fresh), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  return res;
}
