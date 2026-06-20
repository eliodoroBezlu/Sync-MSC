import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ usuarioId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { usuarioId } = await params;

  const competencias = await prisma.tecnicoCompetencia.findMany({
    where: { usuarioId },
    orderBy: { disciplina: "asc" },
  });

  return NextResponse.json(competencias);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { usuarioId } = await params;
  const { searchParams } = new URL(req.url);
  const disciplina = searchParams.get("disciplina");

  if (!disciplina) {
    return NextResponse.json({ error: "disciplina requerida" }, { status: 400 });
  }

  await prisma.tecnicoCompetencia.delete({
    where: { usuarioId_disciplina: { usuarioId, disciplina } },
  });

  return NextResponse.json({ ok: true });
}
