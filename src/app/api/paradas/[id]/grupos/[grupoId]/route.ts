import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { editarGrupoSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string; grupoId: string }> };

// PATCH /api/paradas/[id]/grupos/[grupoId] — dotación propia/apoyo, supervisor.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, grupoId } = await params;
    const parsed = editarGrupoSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.supervisorNombre !== undefined) data.supervisorNombre = d.supervisorNombre;
    if (d.supervisorUsuarioId !== undefined) data.supervisorUsuarioId = d.supervisorUsuarioId ?? null;
    if (d.dotacionPropia !== undefined) data.dotacionPropia = d.dotacionPropia;
    if (d.dotacionApoyo !== undefined) data.dotacionApoyo = d.dotacionApoyo;

    const grupo = await prisma.paradaGrupo.update({
      where: { id: grupoId, paradaId: id },
      data,
    });
    return NextResponse.json({ ok: true, grupo: serialize(grupo) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// DELETE /api/paradas/[id]/grupos/[grupoId]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id, grupoId } = await params;
    await prisma.paradaGrupo.delete({ where: { id: grupoId, paradaId: id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
