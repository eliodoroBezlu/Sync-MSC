import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tag = searchParams.get("tag");
  const disciplina = searchParams.get("disciplina");
  const soloActivos = searchParams.get("soloActivos") !== "false";

  const planes = await prisma.equipoMantenimientoPlan.findMany({
    where: {
      ...(tag ? { tag } : {}),
      ...(disciplina ? { disciplina } : {}),
      ...(soloActivos ? { activo: true } : {}),
    },
    orderBy: { proximoVencimiento: "asc" },
  });
  return NextResponse.json(planes);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tag, disciplina, tipoOT, descripcion, frecuencia, personas, hrsTrabajo, grupo, diasPreferidos, competenciaReq } = body;

    if (!tag || !disciplina) {
      return NextResponse.json({ error: "tag y disciplina requeridos" }, { status: 400 });
    }

    const plan = await prisma.equipoMantenimientoPlan.upsert({
      where: { tag_tipoOT: { tag, tipoOT: tipoOT || "PMT" } },
      create: {
        tag, disciplina, tipoOT: tipoOT || "PMT", descripcion: descripcion || "",
        frecuencia: frecuencia || "semanal", personas: Number(personas) || 1,
        hrsTrabajo: Number(hrsTrabajo) || 2, grupo: grupo || "Diurno",
        diasPreferidos: diasPreferidos || ["Lu", "Vi"], competenciaReq,
      },
      update: {
        frecuencia: frecuencia || "semanal", personas: Number(personas) || 1,
        hrsTrabajo: Number(hrsTrabajo) || 2, grupo: grupo || "Diurno",
        diasPreferidos: diasPreferidos || ["Lu", "Vi"], competenciaReq,
      },
    });
    return NextResponse.json({ ok: true, plan }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
