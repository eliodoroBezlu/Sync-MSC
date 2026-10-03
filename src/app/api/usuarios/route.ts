import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { traeContrasena, MSG_CONTRASENA } from "@/lib/usuario-iam";
import {
  actorDeSesion,
  datosTrabajadorDesde,
  identidadDesdeTrabajador,
  respuestaDeError,
} from "@/lib/padron";
import { crearTrabajador } from "@/lib/iam-padron";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rolParam  = searchParams.get("rol");
  const areaParam = searchParams.get("area");
  const all       = searchParams.get("all") === "true";
  const contratistaParam = searchParams.get("contratista");

  const where: Record<string, unknown> = {};
  if (!all) where.activo = true;
  if (rolParam) {
    // Acepta uno o varios roles separados por coma (p.ej. "4,6" = Técnico + Contratista)
    const roles = rolParam.split(",").map(Number).filter((n) => !Number.isNaN(n));
    if (roles.length === 1) where.rol = roles[0];
    else if (roles.length > 1) where.rol = { in: roles };
  }
  if (contratistaParam === "true") where.esContratista = true;

  const users = await prisma.usuario.findMany({
    where: {
      ...where,
      ...(areaParam ? { areas: { some: { areaCodigo: areaParam } } } : {}),
    },
    include: { areas: true },
    orderBy: { nombre: "asc" },
  });

  return Response.json(
    users.map((u) => ({
      _id: u.id,
      nombre: u.nombre,
      apellido: u.apellido ?? "",
      email: u.email ?? "",
      nombreCompleto: u.apellido ? `${u.nombre} ${u.apellido}` : u.nombre,
      rol: u.rol,
      disciplina: u.disciplina,
      areas: u.areas.map((a) => a.areaCodigo),
      areaTrabajo: u.areaTrabajo ?? "",
      celular: u.celular ?? "",
      jde: u.jde ?? "",
      puesto: u.puesto ?? "",
      superintendencia: u.superintendencia ?? "",
      activo: u.activo,
      esContratista: u.esContratista,
      fechaExpiracion: u.fechaExpiracion ?? null,
      // Entra a Sync con su cuenta del IAM: el login le fija rol, áreas y estado.
      vinculadoIam: u.iamUserId !== null,
      // Tiene cuenta en el IAM: su identidad solo se edita en el portal.
      cuentaIam: u.tieneCuentaIam || u.iamUserId !== null,
      // Enlazada al padrón del IAM.
      enPadron: u.trabajadorId !== null,
    }))
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Aquí se registran personas operativas (asignables a trabajo). Las
    // cuentas con acceso, y sus contraseñas, se crean en el IAM Portal.
    if (traeContrasena(body)) {
      return Response.json({ ok: false, error: MSG_CONTRASENA }, { status: 400 });
    }
    if (!body.nombre?.trim()) {
      return Response.json({ ok: false, error: "La nómina es obligatoria" }, { status: 400 });
    }

    // La persona nace en el padrón del IAM (alta idempotente por CI/JDE). Si el
    // IAM no responde, no se crea nada: un solo padrón.
    const { trabajador } = await crearTrabajador(
      await datosTrabajadorDesde(body, { paraAlta: true }),
      await actorDeSesion(req),
    );

    // ¿Sync ya la tenía? (el IAM devolvió a alguien existente)
    const yaEnSync = await prisma.usuario.findFirst({
      where: {
        OR: [
          { trabajadorId: trabajador.id },
          ...(trabajador.userId ? [{ iamUserId: trabajador.userId }] : []),
        ],
      },
    });
    if (yaEnSync) {
      if (!yaEnSync.trabajadorId) {
        await prisma.usuario.update({
          where: { id: yaEnSync.id },
          data: identidadDesdeTrabajador(trabajador, yaEnSync),
        });
      }
      return Response.json({ ok: true, _id: yaEnSync.id, existente: true });
    }

    const { apellido, email, rol, areas, fechaExpiracion } = body;
    const user = await prisma.usuario.create({
      data: {
        // Identidad: la del IAM; lo que el IAM no tenga, lo del formulario
        ...identidadDesdeTrabajador(trabajador, {
          nombre: body.nombre.trim(),
          jde: body.jde ? String(body.jde).replace(/\.0+$/, "").trim() : null,
          puesto: body.puesto?.trim() || null,
          superintendencia: body.superintendencia?.trim() || null,
          areaTrabajo: body.areaTrabajo?.trim() || null,
          disciplina: body.disciplina ?? "GENERAL",
          celular: body.celular ? String(body.celular).trim() : null,
        }),
        // Propios de Sync
        apellido: apellido?.trim() || null,
        email: email?.trim()?.toLowerCase() || null,
        rol: Number(rol) || 4,
        fechaExpiracion: fechaExpiracion ? new Date(fechaExpiracion) : null,
        areas: {
          create: [...new Set<string>(areas ?? [])].map((codigo) => ({ areaCodigo: codigo })),
        },
      },
    });

    return Response.json({ ok: true, _id: user.id }, { status: 201 });
  } catch (err: unknown) {
    return respuestaDeError(err);
  }
}
