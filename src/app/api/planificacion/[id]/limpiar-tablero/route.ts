import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// Vacía el personal asignado de todas las OTs del plan para volver a armar
// el Tablero desde cero, sin tocar qué OTs están seleccionadas ni en qué
// día está programada cada una (eso se resuelve aparte, en Selección/Tablero).
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "No se puede limpiar un plan publicado" }, { status: 400 });
    }

    const resultado = await prisma.planBorradorOt.updateMany({
      where: { planBorradorId: id },
      data: { personalAsignado: [], personalAsignadoIds: [] },
    });

    return NextResponse.json({ ok: true, otsLimpiadas: resultado.count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error limpiando el tablero";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
