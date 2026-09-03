import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { serialize } from "@/lib/parada/validacion";

// GET /api/paradas/activa?fecha=YYYY-MM-DD
//
// Devuelve la parada en fase "ejecucion" cuyo rango de ejecución cubre `fecha`
// (por defecto hoy), junto con sus OTs y los avances diarios de esa fecha. La usa
// "Registro de OT" para mostrar, además del plan semanal, las OTs de la parada
// que el técnico logueado debe abrir/cerrar. No toca el flujo semanal.
export async function GET(req: NextRequest) {
  const fechaParam = req.nextUrl.searchParams.get("fecha");
  const base = fechaParam ? new Date(`${fechaParam}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    return NextResponse.json({ ok: false, error: "fecha inválida" }, { status: 400 });
  }
  // Ventana del día [00:00, 23:59:59.999] para comparar contra el rango de la parada.
  const finDia = new Date(base);
  finDia.setHours(23, 59, 59, 999);
  const iniDia = new Date(base);
  iniDia.setHours(0, 0, 0, 0);

  const parada = await prisma.parada.findFirst({
    where: {
      estado: "ejecucion",
      fechaEjecucionInicio: { lte: finDia },
      fechaEjecucionFin: { gte: iniDia },
    },
    orderBy: { fechaEjecucionInicio: "desc" },
    include: {
      ots: { orderBy: [{ orden: "asc" }, { numeroOT: "asc" }] },
    },
  });

  if (!parada) return NextResponse.json({ ok: true, parada: null });

  const avances = await prisma.paradaAvanceDiario.findMany({
    where: {
      paradaId: parada.id,
      fecha: { gte: iniDia, lte: finDia },
    },
  });

  return NextResponse.json({
    ok: true,
    parada: {
      ...serialize(parada),
      ots: parada.ots.map((o) => serialize(o)),
      avancesHoy: avances.map((a) => serialize(a)),
    },
  });
}
