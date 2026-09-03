import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { crearParadaSchema, serialize, zodError } from "@/lib/parada/validacion";

// GET /api/paradas — lista de paradas (más reciente primero).
export async function GET() {
  const paradas = await prisma.parada.findMany({
    orderBy: [{ fechaEjecucionInicio: "desc" }],
    include: {
      _count: { select: { ots: true, grupos: true, reportesDiarios: true } },
    },
  });
  return NextResponse.json(paradas.map((p) => serialize(p)));
}

// POST /api/paradas — crea la parada y siembra los grupos base Día/Noche.
export async function POST(req: NextRequest) {
  try {
    const parsed = crearParadaSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;

    const parada = await prisma.parada.create({
      data: {
        codigo: d.codigo.toUpperCase(),
        nombre: d.nombre,
        planta: d.planta ?? null,
        fechaPreparativosInicio: d.fechaPreparativosInicio,
        fechaEjecucionInicio: d.fechaEjecucionInicio,
        fechaEjecucionFin: d.fechaEjecucionFin,
        creadoPor: d.creadoPor,
        grupos: {
          create: [
            { turno: "Dia", disciplina: "MIXTO", supervisorNombre: "" },
            { turno: "Noche", disciplina: "MIXTO", supervisorNombre: "" },
          ],
        },
      },
      include: { grupos: true },
    });

    return NextResponse.json({ ok: true, parada: serialize(parada) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
