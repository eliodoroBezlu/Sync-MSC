import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { expandirDias } from "@/lib/planificacion/expandirDias";

type Ctx = { params: Promise<{ id: string; otId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { otId } = await params;
    const body = await req.json();

    const data: Record<string, unknown> = {};

    const campos = [
      "numeroOT", "tipoOT", "tipoTrabajo", "prioridad", "descripcion",
      "tag", "descripcionEquipo", "grupo", "esGuardia",
      "personalAsignado", "personalAsignadoIds",
      "seleccionada", "motivoNoProgramada", "comentarioNoProgramada",
    ];
    for (const c of campos) {
      if (c in body) data[c] = body[c];
    }
    if ("personas" in body || "hrsTrabajo" in body) {
      const ot = await prisma.planBorradorOt.findUnique({ where: { id: otId } });
      if (!ot) return NextResponse.json({ error: "OT no encontrada" }, { status: 404 });
      const personas   = Number(body.personas   ?? ot.personas);
      const hrsTrabajo = Number(body.hrsTrabajo ?? ot.hrsTrabajo);
      data.personas   = personas;
      data.hrsTrabajo = hrsTrabajo;
      data.hhTotal    = personas * hrsTrabajo;
    }
    if ("fechaInicioOt" in body) data.fechaInicioOt = body.fechaInicioOt ? new Date(body.fechaInicioOt) : null;
    if ("fechaFinOt"    in body) data.fechaFinOt    = body.fechaFinOt    ? new Date(body.fechaFinOt)    : null;
    if ("diasTexto"     in body) {
      data.diasTexto = body.diasTexto;
      data.dias      = body.dias?.length ? body.dias : expandirDias(body.diasTexto ?? "");
    }
    if ("dias" in body) data.dias = body.dias;

    const ot = await prisma.planBorradorOt.update({ where: { id: otId }, data });
    return NextResponse.json({ ok: true, ot: { ...ot, _id: ot.id } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { otId } = await params;
  try {
    await prisma.planBorradorOt.delete({ where: { id: otId } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
