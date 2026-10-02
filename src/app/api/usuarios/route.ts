import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { traeContrasena, MSG_CONTRASENA } from "@/lib/usuario-iam";

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
      // Inicia sesión con su cuenta del IAM: su identidad se gestiona allí.
      vinculadoIam: u.iamUserId !== null,
    }))
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Aquí solo se registran personas operativas (asignables a trabajo). Las
    // cuentas con acceso, y sus contraseñas, se crean en el IAM Portal.
    if (traeContrasena(body)) {
      return Response.json({ ok: false, error: MSG_CONTRASENA }, { status: 400 });
    }
    const { nombre, apellido, email, rol, areas, areaTrabajo,
            celular, jde, puesto, superintendencia, disciplina,
            esContratista, fechaExpiracion } = body;

    const user = await prisma.usuario.create({
      data: {
        nombre: nombre?.trim(),
        apellido: apellido?.trim() || null,
        email: email?.trim()?.toLowerCase() || null,
        rol: Number(rol),
        disciplina: disciplina ?? "GENERAL",
        areaTrabajo: areaTrabajo?.trim() || null,
        celular: celular ? String(celular).trim() : null,
        jde: jde ? String(jde).replace(/\.0+$/, "").trim() : null,
        puesto: puesto?.trim() || null,
        superintendencia: superintendencia?.trim() || null,
        activo: body.activo !== undefined ? body.activo : true,
        esContratista: esContratista === true,
        fechaExpiracion: fechaExpiracion ? new Date(fechaExpiracion) : null,
        areas: {
          create: (areas ?? []).map((codigo: string) => ({ areaCodigo: codigo })),
        },
      },
    });

    return Response.json({ ok: true, _id: user.id }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
