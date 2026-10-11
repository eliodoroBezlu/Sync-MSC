import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import {
  traeContrasena,
  camposModificados,
  cambiosDeIdentidad,
  mensajeCamposIam,
  datosLocales,
  MSG_CONTRASENA,
  MSG_ELIMINAR_VINCULADO,
} from "@/lib/usuario-iam";
import { camposDelIam } from "@/lib/padron-campos";
import {
  gestionDe,
  actorDeSesion,
  datosTrabajadorDesde,
  identidadDesdeTrabajador,
  respuestaDeError,
} from "@/lib/padron";
import { actualizarTrabajador } from "@/lib/iam-padron";

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

    // Lo que el IAM define para esta persona no se edita aquí: no duraría.
    const g = gestionDe(actual);
    const bloqueados = camposModificados(actual, body, camposDelIam(g));
    if (bloqueados.length > 0) {
      return Response.json(
        { ok: false, gestionadoPorIam: true, error: mensajeCamposIam(bloqueados, g) },
        { status: 409 },
      );
    }

    // Identidad de una persona SIN cuenta: se escribe primero en el IAM y la
    // copia local sale de su respuesta. Si el IAM no responde, no se guarda nada.
    let identidad = {};
    const cambios = cambiosDeIdentidad(actual, body, g);
    if (cambios.length > 0) {
      const t = await actualizarTrabajador(
        actual.trabajadorId,
        await datosTrabajadorDesde(Object.fromEntries(cambios.map((c) => [c, body[c]]))),
        await actorDeSesion(req),
      );
      // "El IAM completa, no borra"; pero lo que el usuario acaba de vaciar sí se
      // vacía, así que el respaldo es el valor nuevo para lo que cambió.
      type CampoTexto = "nombre" | "jde" | "puesto" | "superintendencia" | "areaTrabajo" | "disciplina" | "celular";
      const respaldo = (c: CampoTexto): string | null => {
        if (!cambios.includes(c)) return actual[c];
        const v = body[c];
        return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
      };
      identidad = identidadDesdeTrabajador(t, {
        nombre: respaldo("nombre") ?? actual.nombre,
        jde: respaldo("jde"),
        puesto: respaldo("puesto"),
        superintendencia: respaldo("superintendencia"),
        areaTrabajo: respaldo("areaTrabajo"),
        disciplina: respaldo("disciplina") ?? actual.disciplina,
        celular: respaldo("celular"),
      });
    }

    const areas =
      !camposDelIam(g).has("areas") && Array.isArray(body.areas)
        ? [...new Set(body.areas.map(String))]
        : undefined;

    await prisma.usuario.update({
      where: { id },
      data: {
        ...datosLocales(body, g),
        ...identidad,
        ...(areas !== undefined
          ? { areas: { deleteMany: {}, create: areas.map((areaCodigo) => ({ areaCodigo })) } }
          : {}),
      },
    });

    return Response.json({ ok: true });
  } catch (err: unknown) {
    return respuestaDeError(err);
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
    // Solo la quita del padrón de Sync: la persona sigue en el IAM.
    await prisma.usuario.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return respuestaDeError(err);
  }
}
