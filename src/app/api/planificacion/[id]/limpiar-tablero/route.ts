import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// Limpia el Tablero de verdad: las OTs comunes se sacan del tablero (vuelven
// a la pestaña Selección, sin día ni grupo ni técnico) para armar todo de
// cero desde ahí. La guardia OPEPLANT nunca se saca del tablero —es fija
// toda la semana, en ambos turnos— así que a esas solo se les limpia el
// técnico asignado.
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "No se puede limpiar un plan publicado" }, { status: 400 });
    }

    const [otsNormales, otsGuardia] = await Promise.all([
      prisma.planBorradorOt.updateMany({
        where: { planBorradorId: id, esGuardia: false },
        data: {
          seleccionada: false,
          personalAsignado: [],
          personalAsignadoIds: [],
          dias: [],
          diasTexto: null,
          grupo: "Diurno",
        },
      }),
      prisma.planBorradorOt.updateMany({
        where: { planBorradorId: id, esGuardia: true },
        data: { personalAsignado: [], personalAsignadoIds: [] },
      }),
    ]);

    return NextResponse.json({ ok: true, otsLimpiadas: otsNormales.count + otsGuardia.count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error limpiando el tablero";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
