import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const usuarioId = searchParams.get("usuarioId");
  const tag = searchParams.get("tag");
  const minEficiencia = Number(searchParams.get("minEficiencia") || "0");

  const desempenios = await prisma.tecnicoDesempenio.findMany({
    where: {
      ...(usuarioId ? { usuarioId } : {}),
      ...(tag ? { tag } : {}),
      eficiencia: { gte: minEficiencia },
    },
    orderBy: [{ eficiencia: "desc" }, { ultimaFecha: "desc" }],
  });

  return NextResponse.json(desempenios);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { usuarioId, tag, tipoOT, otasCompletadas, tiempoPromedio, eficiencia, tendencia } = body;

    if (!usuarioId || !tag || !tipoOT) {
      return NextResponse.json({ error: "usuarioId, tag y tipoOT requeridos" }, { status: 400 });
    }

    const desp = await prisma.tecnicoDesempenio.upsert({
      where: { usuarioId_tag_tipoOT: { usuarioId, tag, tipoOT } },
      create: {
        usuarioId,
        tag,
        tipoOT,
        otasCompletadas: Number(otasCompletadas) || 0,
        tiempoPromedio: Number(tiempoPromedio) || 0,
        eficiencia: Number(eficiencia) || 100,
        tendencia: tendencia || "estable",
        ultimaFecha: new Date(),
      },
      update: {
        otasCompletadas: Number(otasCompletadas) || 0,
        tiempoPromedio: Number(tiempoPromedio) || 0,
        eficiencia: Number(eficiencia) || 100,
        tendencia: tendencia || "estable",
        ultimaFecha: new Date(),
      },
    });

    return NextResponse.json({ ok: true, desempenio: desp }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
