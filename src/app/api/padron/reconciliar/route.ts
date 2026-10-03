// POST /api/padron/reconciliar[?dry=1] — puesta en marcha del padrón único.
// Enlaza las personas de Sync con el IAM y da de ALTA en el IAM a las que no
// estén allí. Con ?dry=1 solo informa qué haría. Solo administradores.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { reconciliarPadron, actorDeSesion, respuestaDeError } from "@/lib/padron";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sesion = token ? await verifyToken(token) : null;
  if (!sesion) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  // Crea registros en el IAM: no basta con tener sesión.
  if (sesion.rol !== 1) {
    return NextResponse.json(
      { ok: false, error: "Solo un administrador puede reconciliar el padrón con el IAM." },
      { status: 403 },
    );
  }

  try {
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const r = await reconciliarPadron({ dry, actor: await actorDeSesion(req) });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return respuestaDeError(err);
  }
}
