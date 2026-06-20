import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { expandirDias } from "@/lib/planificacion/expandirDias";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();

    const personas   = Number(body.personas ?? 1);
    const hrsTrabajo = Number(body.hrsTrabajo ?? 0);
    const hhTotal    = personas * hrsTrabajo;
    const dias       = body.dias?.length
      ? body.dias
      : expandirDias(body.diasTexto ?? "");

    // Calcular control (siguiente número)
    const count = await prisma.planBorradorOt.count({ where: { planBorradorId: id } });

    const ot = await prisma.planBorradorOt.create({
      data: {
        planBorradorId: id,
        control: body.control ?? (count + 1),
        numeroOT:         String(body.numeroOT ?? "").trim(),
        tipoOT:           String(body.tipoOT ?? "").trim().toUpperCase(),
        tipoTrabajo:      String(body.tipoTrabajo ?? "").trim(),
        prioridad:        body.prioridad ? String(body.prioridad) : null,
        descripcion:      String(body.descripcion ?? "").trim(),
        tag:              String(body.tag ?? "").trim().toUpperCase(),
        descripcionEquipo: String(body.descripcionEquipo ?? "").trim(),
        personas, hrsTrabajo, hhTotal,
        fechaInicioOt:    body.fechaInicioOt ? new Date(body.fechaInicioOt) : null,
        fechaFinOt:       body.fechaFinOt    ? new Date(body.fechaFinOt)    : null,
        diasTexto:        body.diasTexto ?? null,
        dias,
        grupo:            body.grupo ?? "Diurno",
        personalAsignado:    body.personalAsignado    ?? [],
        personalAsignadoIds: body.personalAsignadoIds ?? [],
        esGuardia:        body.esGuardia ?? false,
      },
    });

    return NextResponse.json({ ok: true, ot: { ...ot, _id: ot.id } }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
