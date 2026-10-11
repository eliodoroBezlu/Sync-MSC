// POST /api/padron/sync — trae del IAM la identidad de las personas de Sync y
// enlaza las que se puedan enlazar con seguridad (por cuenta o JDE).
// Solo lee del IAM: no crea personas en ningún lado.
import { NextResponse } from "next/server";
import { refrescarPadron, respuestaDeError } from "@/lib/padron";

export const runtime = "nodejs";

export async function POST() {
  try {
    const r = await refrescarPadron();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return respuestaDeError(err);
  }
}
