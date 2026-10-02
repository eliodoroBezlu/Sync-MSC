// POST /api/padron/completar[?dry=1] — completa en el IAM lo que allí está
// vacío y Sync sabe (JDE, disciplina, celular, área). Nunca pisa un dato del
// IAM. Con ?dry=1 solo informa qué haría. Solo administradores.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { completarPadronEnIam, actorDeSesion, respuestaDeError } from "@/lib/padron";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sesion = token ? await verifyToken(token) : null;
  if (!sesion) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  // Escribe en el IAM: no basta con tener sesión.
  if (sesion.rol !== 1) {
    return NextResponse.json(
      { ok: false, error: "Solo un administrador puede completar el padrón del IAM." },
      { status: 403 },
    );
  }

  try {
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const r = await completarPadronEnIam({ dry, actor: await actorDeSesion(req) });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return respuestaDeError(err);
  }
}
