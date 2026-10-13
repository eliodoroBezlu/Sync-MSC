import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { exigirRol } from "@/lib/calibracion/acceso";

const ROLES_ELIMINAR = [1]; // solo Admin

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const registro = await prisma.registroCalibracion.findUnique({ where: { id } });
  if (!registro) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json({ ...registro, _id: registro.id });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body: {
      stickerImpreso?: boolean;
      observaciones?: string;
      estado?: string;
      supervisorFirma?: string;
      supervisorId?: string;
      supervisorNombre?: string;
    } = await req.json();
    const registro = await prisma.registroCalibracion.update({
      where: { id },
      data: {
        ...(typeof body.stickerImpreso === "boolean" ? { stickerImpreso: body.stickerImpreso } : {}),
        ...(typeof body.observaciones  === "string"  ? { observaciones:  body.observaciones  } : {}),
        ...(typeof body.estado         === "string"  ? { estado:         body.estado         } : {}),
        ...(typeof body.supervisorFirma === "string" ? { supervisorFirma: body.supervisorFirma } : {}),
        ...(typeof body.supervisorId   === "string"  ? { supervisorId:   body.supervisorId   } : {}),
        ...(typeof body.supervisorNombre === "string" ? { supervisorNombre: body.supervisorNombre } : {}),
      },
    });
    return Response.json({ ok: true, registro: { ...registro, _id: registro.id } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const denegado = await exigirRol(req, ROLES_ELIMINAR);
  if (denegado) return denegado;
  try {
    const { id } = await params;
    await prisma.registroCalibracion.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err: unknown) {
    console.error("Error al eliminar registro de calibración", err);
    return Response.json({ ok: false, error: "No se pudo eliminar el registro" }, { status: 400 });
  }
}
