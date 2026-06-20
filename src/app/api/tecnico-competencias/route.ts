import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const usuarioId = searchParams.get("usuarioId");
  const disciplina = searchParams.get("disciplina");

  const where: Record<string, unknown> = {};
  if (usuarioId) where.usuarioId = usuarioId;
  if (disciplina) where.disciplina = disciplina;

  const competencias = await prisma.tecnicoCompetencia.findMany({
    where, orderBy: { disciplina: "asc" },
  });
  return NextResponse.json(competencias);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { usuarioId, disciplina, nivel, competencias, certificado, validaHasta } = body;

    const comp = await prisma.tecnicoCompetencia.upsert({
      where: { usuarioId_disciplina: { usuarioId, disciplina } },
      create: { usuarioId, disciplina, nivel: nivel || "Básico", competencias: competencias || [], certificado: certificado || false, validaHasta: validaHasta ? new Date(validaHasta) : null },
      update: { nivel: nivel || "Básico", competencias: competencias || [], certificado: certificado || false, validaHasta: validaHasta ? new Date(validaHasta) : null },
    });
    return NextResponse.json({ ok: true, competencia: comp }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
