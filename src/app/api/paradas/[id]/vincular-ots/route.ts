import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/paradas/[id]/vincular-ots
// Enlaza cada ParadaOt (sin ordenTrabajoId) con la OrdenTrabajo real que tenga
// el mismo numeroOT. Devuelve cuántas se enlazaron y las que no se encontraron.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const pendientes = await prisma.paradaOt.findMany({
      where: { paradaId: id, ordenTrabajoId: null },
      select: { id: true, numeroOT: true },
    });
    if (pendientes.length === 0) {
      return NextResponse.json({ ok: true, vinculadas: 0, noEncontradas: [] });
    }

    const numeros = [...new Set(pendientes.map((o) => o.numeroOT))];
    const reales = await prisma.ordenTrabajo.findMany({
      where: { numeroOT: { in: numeros } },
      select: { id: true, numeroOT: true },
    });
    const mapa = new Map(reales.map((r) => [r.numeroOT, r.id]));

    let vinculadas = 0;
    const noEncontradas: string[] = [];
    for (const ot of pendientes) {
      const realId = mapa.get(ot.numeroOT);
      if (!realId) {
        noEncontradas.push(ot.numeroOT);
        continue;
      }
      await prisma.paradaOt.update({
        where: { id: ot.id },
        data: { ordenTrabajoId: realId },
      });
      vinculadas++;
    }

    return NextResponse.json({ ok: true, vinculadas, noEncontradas });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
