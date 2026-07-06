// POST /api/areas/sync — sincroniza el catálogo de áreas desde el IAM.
import { NextResponse } from "next/server";
import { syncAreasFromIam } from "@/lib/sync-areas";

export const runtime = "nodejs";

export async function POST() {
  const result = await syncAreasFromIam();
  if (result.error) {
    return NextResponse.json({ ok: false, ...result }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ...result });
}
