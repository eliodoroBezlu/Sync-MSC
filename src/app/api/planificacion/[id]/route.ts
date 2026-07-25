import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

function serialize(p: Record<string, unknown>) {
  return { ...p, _id: p.id };
}

// La matriz de cuadrilla (técnico×grupo×día) se carga aparte vía
// GET /api/planificacion/[id]/cuadrillas — esa ruta también se encarga del
// sembrado inicial la primera vez que se visita un plan.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const plan = await prisma.planBorrador.findUnique({
    where: { id },
    include: { ots: { orderBy: { control: "asc" } }, roster: { orderBy: { nombre: "asc" } } },
  });
  if (!plan) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(serialize(plan as Record<string, unknown>));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { estado, publicadoEn, programacionSemanalId } = body;

    const data: Record<string, unknown> = {};
    if (estado) data.estado = estado;
    if (publicadoEn) data.publicadoEn = new Date(publicadoEn);
    if (programacionSemanalId) data.programacionSemanalId = programacionSemanalId;

    const plan = await prisma.planBorrador.update({
      where: { id }, data,
      include: { ots: true, roster: true },
    });
    return NextResponse.json({ ok: true, plan: serialize(plan as Record<string, unknown>) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await prisma.planBorrador.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
