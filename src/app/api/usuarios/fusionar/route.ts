// POST /api/usuarios/fusionar — une dos registros de la misma persona.
// Body: { conservarId, eliminarId, dry? }. Con dry: true solo informa qué
// reasignaría. Solo administradores: reescribe referencias en todo Sync.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { planificarFusion, fusionarPersonas, FusionInvalida } from "@/lib/fusion-personas";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sesion = token ? await verifyToken(token) : null;
  if (!sesion) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  if (sesion.rol !== 1) {
    return NextResponse.json(
      { ok: false, error: "Solo un administrador puede fusionar personas." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    conservarId?: unknown; eliminarId?: unknown; dry?: unknown;
  };
  if (typeof body.conservarId !== "string" || typeof body.eliminarId !== "string") {
    return NextResponse.json({ ok: false, error: "Faltan conservarId y eliminarId" }, { status: 400 });
  }
  if (body.eliminarId === sesion.id) {
    return NextResponse.json(
      { ok: false, error: "No puedes eliminar tu propio registro: consérvalo y fusiona el otro en él." },
      { status: 400 },
    );
  }

  try {
    const plan = body.dry === true
      ? await planificarFusion(body.conservarId, body.eliminarId)
      : await fusionarPersonas(body.conservarId, body.eliminarId);
    return NextResponse.json({ ok: true, dry: body.dry === true, ...plan });
  } catch (err) {
    if (err instanceof FusionInvalida) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    console.error("💥 [fusión]", err);
    return NextResponse.json({ ok: false, error: "No se pudo fusionar: no se cambió nada." }, { status: 500 });
  }
}
