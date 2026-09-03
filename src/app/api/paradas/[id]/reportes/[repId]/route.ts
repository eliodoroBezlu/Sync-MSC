import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { editarReporteSchema, serialize, zodError } from "@/lib/parada/validacion";
import type { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string; repId: string }> };

// GET /api/paradas/[id]/reportes/[repId]
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, repId } = await params;
  const reporte = await prisma.paradaReporteDiario.findFirst({
    where: { id: repId, paradaId: id },
  });
  if (!reporte) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(serialize(reporte));
}

// PATCH /api/paradas/[id]/reportes/[repId] — editar / marcar "emitido".
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, repId } = await params;
    const parsed = editarReporteSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const data: Prisma.ParadaReporteDiarioUpdateInput = {};
    if (d.resumen !== undefined) data.resumen = d.resumen;
    if (d.avanceGlobalPct !== undefined) data.avanceGlobalPct = d.avanceGlobalPct;
    if (d.hhPropias !== undefined) data.hhPropias = d.hhPropias;
    if (d.hhApoyo !== undefined) data.hhApoyo = d.hhApoyo;
    if (d.otsTerminadas !== undefined) data.otsTerminadas = d.otsTerminadas;
    if (d.otsConRetraso !== undefined) data.otsConRetraso = d.otsConRetraso as Prisma.InputJsonValue;
    if (d.pendientes !== undefined) data.pendientes = d.pendientes as Prisma.InputJsonValue;
    if (d.observaciones !== undefined) data.observaciones = d.observaciones ?? null;
    if (d.estado !== undefined) data.estado = d.estado;
    if (d.pdfUrl !== undefined) data.pdfUrl = d.pdfUrl ?? null;

    const existe = await prisma.paradaReporteDiario.findFirst({
      where: { id: repId, paradaId: id },
      select: { id: true },
    });
    if (!existe) return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });

    const reporte = await prisma.paradaReporteDiario.update({ where: { id: repId }, data });
    return NextResponse.json({ ok: true, reporte: serialize(reporte) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
