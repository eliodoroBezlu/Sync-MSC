import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = await req.json();
    const area = await prisma.area.update({
      where: { codigo: id },
      data: body,
    });
    return Response.json({ ok: true, area });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "true";
  try {
    if (force) {
      // Asegurar área "0000" existe como refugio para huérfanos
      await prisma.area.upsert({
        where: { codigo: "0000" },
        update: {},
        create: { codigo: "0000", nombre: "Sin área", superintendencia: "" },
      });

      // Reasignar todos los registros huérfanos al área "0000"
      await prisma.equipo.updateMany({ where: { areaCodigo: id }, data: { areaCodigo: "0000" } });
      await prisma.ordenTrabajo.updateMany({ where: { areaCodigo: id }, data: { areaCodigo: "0000" } });
      await prisma.programacionSemanal.updateMany({ where: { areaCodigo: id }, data: { areaCodigo: "0000" } });
      await prisma.registroCalibracion.updateMany({ where: { areaCodigo: id }, data: { areaCodigo: "0000" } });
    }

    await prisma.area.delete({ where: { codigo: id } });
    return Response.json({ ok: true, force });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
