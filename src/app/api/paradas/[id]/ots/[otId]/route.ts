import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { editarOtSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string; otId: string }> };

// PATCH /api/paradas/[id]/ots/[otId] — edita una OT de la parada.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, otId } = await params;
    const parsed = editarOtSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.numeroOT !== undefined) data.numeroOT = d.numeroOT;
    if (d.descripcion !== undefined) data.descripcion = d.descripcion;
    if (d.tag !== undefined) data.tag = d.tag.toUpperCase();
    if (d.descripcionEquipo !== undefined) data.descripcionEquipo = d.descripcionEquipo;
    if (d.disciplina !== undefined) data.disciplina = d.disciplina;
    if (d.fase !== undefined) data.fase = d.fase;
    if (d.hhEstimadas !== undefined) data.hhEstimadas = d.hhEstimadas;
    if (d.fechaProg !== undefined) data.fechaProg = d.fechaProg ?? null;
    if (d.fechaProgFin !== undefined) data.fechaProgFin = d.fechaProgFin ?? null;
    if (d.grupo !== undefined) data.grupo = d.grupo;
    if (d.responsable !== undefined) data.responsable = d.responsable ?? null;
    if (d.critica !== undefined) data.critica = d.critica;
    if (d.estado !== undefined) data.estado = d.estado;
    if (d.avancePct !== undefined) data.avancePct = d.avancePct;
    if (d.observaciones !== undefined) data.observaciones = d.observaciones ?? null;
    if (d.orden !== undefined) data.orden = d.orden ?? null;

    const ot = await prisma.paradaOt.update({
      where: { id: otId, paradaId: id },
      data,
    });
    return NextResponse.json({ ok: true, ot: serialize(ot) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// DELETE /api/paradas/[id]/ots/[otId]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id, otId } = await params;
    await prisma.paradaOt.delete({ where: { id: otId, paradaId: id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
