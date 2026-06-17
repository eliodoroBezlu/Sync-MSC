import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const include = { otsProgramadas: true, personal: true, resumenDias: true };

function serialize(p: Record<string, unknown>) {
  return { ...p, _id: p.id };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const programa = await prisma.programacionSemanal.findUnique({ where: { id }, include });
  if (!programa) return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
  return Response.json(serialize(programa as Record<string, unknown>));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    // Solo actualizar campos de nivel superior (no otsProgramadas)
    const { otsProgramadas, personal, resumenDias, ...topLevel } = body;
    void otsProgramadas; void personal; void resumenDias;
    const programa = await prisma.programacionSemanal.update({
      where: { id }, data: topLevel, include,
    });
    return Response.json({ ok: true, programa: serialize(programa as Record<string, unknown>) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

// Actualizar estado de una OT específica dentro de la programación
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { numeroOT, dia, estado, observaciones,
            pasarNoche, pasarNocheMotivo, pasarNocheNota, pasarNochePor,
            personalAsignado, personalAsignadoIds } = body;

    if (!numeroOT || !dia)
      return Response.json({ ok: false, error: "numeroOT y dia son requeridos" }, { status: 400 });

    const whereBase = { programacionSemanalId: id, numeroOT, dia };
    const whereGrupo = body.grupo
      ? { ...whereBase, grupo: String(body.grupo) }
      : whereBase;

    await prisma.otProgramada.updateMany({
      where: whereGrupo,
      data: {
        ...(estado             !== undefined ? { estado } : {}),
        ...(observaciones      !== undefined ? { observaciones } : {}),
        ...(personalAsignado    !== undefined ? { personalAsignado } : {}),
        ...(personalAsignadoIds !== undefined ? { personalAsignadoIds } : {}),
        ...(body.nuevoGrupo ? { grupo: String(body.nuevoGrupo) } : {}),
        ...(pasarNoche         !== undefined ? {
          pasarNoche,
          pasarNocheMotivo: pasarNocheMotivo ?? "",
          pasarNocheNota:   pasarNocheNota   ?? "",
          pasarNochePor:    pasarNochePor     ?? "",
          pasarNocheAt:     pasarNoche ? new Date() : null,
        } : {}),
      },
    });

    const programa = await prisma.programacionSemanal.findUnique({ where: { id }, include });
    if (!programa) return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
    return Response.json({ ok: true, programa: serialize(programa as Record<string, unknown>) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
