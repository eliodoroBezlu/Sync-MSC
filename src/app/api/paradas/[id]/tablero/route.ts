import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { calcularTablero } from "@/lib/parada/indicadores";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/paradas/[id]/tablero?hoy=YYYY-MM-DD
// Indicadores calculados en el servidor (misma fuente para encabezado y PDF).
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const parada = await prisma.parada.findUnique({
    where: { id },
    include: { ots: true, avances: true },
  });
  if (!parada) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const hoyParam = req.nextUrl.searchParams.get("hoy");
  const hoy = hoyParam ? new Date(`${hoyParam}T12:00:00.000Z`) : new Date();

  const tablero = calcularTablero(parada, hoy);
  return NextResponse.json({
    parada: {
      _id: parada.id,
      id: parada.id,
      codigo: parada.codigo,
      nombre: parada.nombre,
      estado: parada.estado,
      fechaPreparativosInicio: parada.fechaPreparativosInicio,
      fechaEjecucionInicio: parada.fechaEjecucionInicio,
      fechaEjecucionFin: parada.fechaEjecucionFin,
    },
    tablero,
  });
}
