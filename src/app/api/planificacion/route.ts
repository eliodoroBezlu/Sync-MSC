import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { areaToDisciplina } from "@/lib/planificacion/areaToDisciplina";

function serialize(p: Record<string, unknown>) {
  return { ...p, _id: p.id };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const semana    = searchParams.get("semana");
  const anio      = searchParams.get("anio");
  const areaCodigo = searchParams.get("areaCodigo");
  const estado    = searchParams.get("estado");
  const limit     = Math.min(Number(searchParams.get("limit") || "50"), 200);

  const planes = await prisma.planBorrador.findMany({
    where: {
      ...(semana     ? { semana: Number(semana) }   : {}),
      ...(anio       ? { anio: Number(anio) }       : {}),
      ...(areaCodigo ? { areaCodigo }               : {}),
      ...(estado     ? { estado }                   : {}),
    },
    include: { ots: true, roster: true },
    orderBy: [{ anio: "desc" }, { semana: "desc" }],
    take: limit,
  });

  return NextResponse.json(planes.map(p => serialize(p as Record<string, unknown>)));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { semana, anio, areaCodigo, creadoPor } = body;

    if (!semana || !anio || !areaCodigo || !creadoPor) {
      return NextResponse.json({ ok: false, error: "semana, anio, areaCodigo y creadoPor son requeridos" }, { status: 400 });
    }

    const disciplina = areaToDisciplina(areaCodigo);

    const plan = await prisma.planBorrador.upsert({
      where: { semana_anio_areaCodigo: { semana: Number(semana), anio: Number(anio), areaCodigo } },
      create: { semana: Number(semana), anio: Number(anio), areaCodigo, disciplina, creadoPor, estado: "borrador" },
      update: {},
      include: { ots: true, roster: true },
    });

    return NextResponse.json({ ok: true, plan: serialize(plan as Record<string, unknown>) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
