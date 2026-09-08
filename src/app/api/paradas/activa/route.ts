import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { serialize } from "@/lib/parada/validacion";

// GET /api/paradas/activa?fecha=YYYY-MM-DD
// GET /api/paradas/activa?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//
// Devuelve la parada NO cerrada cuyo rango de ejecución cruza el día `fecha`
// (por defecto hoy) o el rango `[desde, hasta]`, junto con sus OTs y los avances
// diarios de esa ventana. Se acepta también estado "preparativos": el personal
// necesita ver sus OT de parada para prepararse antes de que alguien marque la
// parada como "ejecucion", y "Registro de OT" muestra la semana completa aunque
// hoy quede fuera del rango de la parada. No toca el flujo semanal.
function parseDia(valor: string | null): Date | null {
  if (!valor) return null;
  const d = new Date(`${valor}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const desdeParam = parseDia(sp.get("desde"));
  const hastaParam = parseDia(sp.get("hasta"));

  // Ventana a comparar contra el rango de la parada: rango [desde, hasta] si se
  // pide, si no el día `fecha` (o hoy) completo [00:00, 23:59:59.999].
  let iniDia: Date;
  let finDia: Date;
  if (desdeParam || hastaParam) {
    const a = desdeParam ?? hastaParam!;
    const b = hastaParam ?? desdeParam!;
    iniDia = new Date(Math.min(a.getTime(), b.getTime()));
    iniDia.setHours(0, 0, 0, 0);
    finDia = new Date(Math.max(a.getTime(), b.getTime()));
    finDia.setHours(23, 59, 59, 999);
  } else {
    const base = parseDia(sp.get("fecha")) ?? new Date();
    if (Number.isNaN(base.getTime())) {
      return NextResponse.json({ ok: false, error: "fecha inválida" }, { status: 400 });
    }
    iniDia = new Date(base);
    iniDia.setHours(0, 0, 0, 0);
    finDia = new Date(base);
    finDia.setHours(23, 59, 59, 999);
  }

  const parada = await prisma.parada.findFirst({
    where: {
      estado: { not: "cerrada" },
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
