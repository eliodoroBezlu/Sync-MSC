import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import {
  traeContrasena,
  camposIamModificados,
  mensajeCamposIam,
  datosEditables,
  MSG_CONTRASENA,
  MSG_ELIMINAR_VINCULADO,
} from "@/lib/usuario-iam";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;

    if (traeContrasena(body)) {
      return Response.json({ ok: false, error: MSG_CONTRASENA }, { status: 400 });
    }

    const actual = await prisma.usuario.findUnique({ where: { id }, include: { areas: true } });
    if (!actual) {
      return Response.json({ ok: false, error: "Usuario no encontrado" }, { status: 404 });
    }

    // Vinculado al IAM: su identidad la define el IAM y se re-sincroniza en cada
    // login. Rechazar el cambio es más honesto que guardarlo y que se pierda.
    const vinculado = actual.iamUserId !== null;
    if (vinculado) {
      const cambios = camposIamModificados(actual, body);
      if (cambios.length > 0) {
        return Response.json(
          { ok: false, gestionadoPorIam: true, error: mensajeCamposIam(cambios) },
          { status: 409 },
        );
      }
    }

    const areas =
      !vinculado && Array.isArray(body.areas) ? [...new Set(body.areas.map(String))] : undefined;

    await prisma.usuario.update({
      where: { id },
      data: {
        ...datosEditables(body, vinculado),
        ...(areas !== undefined
          ? { areas: { deleteMany: {}, create: areas.map((areaCodigo) => ({ areaCodigo })) } }
          : {}),
      },
    });

    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const actual = await prisma.usuario.findUnique({ where: { id }, select: { iamUserId: true } });
    if (actual?.iamUserId) {
      return Response.json(
        { ok: false, gestionadoPorIam: true, error: MSG_ELIMINAR_VINCULADO },
        { status: 409 },
      );
    }
    await prisma.usuario.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
