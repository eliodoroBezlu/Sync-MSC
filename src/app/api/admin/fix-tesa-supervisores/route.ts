import { prisma } from "@/lib/prisma";

const SUPERVISORES = ["Viñola", "Vinola", "Gomez", "Gómez"];
const AREA_TESA = "3348";

async function agregarArea(nombreFragmentos: string[], areaCodigo: string) {
  const usuarios = await prisma.usuario.findMany({
    where: { OR: nombreFragmentos.map(n => ({ nombre: { contains: n, mode: "insensitive" as const } })) },
    include: { areas: true },
  });

  return Promise.all(usuarios.map(async u => {
    const yaTiene = u.areas.some(a => a.areaCodigo === areaCodigo);
    if (yaTiene) return { id: u.id, nombre: u.nombre, accion: "sin_cambio", areas: u.areas.map(a => a.areaCodigo) };

    const areasActuales = u.areas.map(a => a.areaCodigo);
    await prisma.usuario.update({
      where: { id: u.id },
      data: {
        areas: {
          deleteMany: {},
          create: [...areasActuales, areaCodigo].map(codigo => ({ areaCodigo: codigo })),
        },
      },
    });
    return { id: u.id, nombre: u.nombre, accion: "area_agregada", areaNueva: areaCodigo, areasFinales: [...areasActuales, areaCodigo] };
  }));
}

export async function GET() {
  const usuarios = await prisma.usuario.findMany({
    where: { OR: SUPERVISORES.map(n => ({ nombre: { contains: n, mode: "insensitive" as const } })) },
    include: { areas: true },
  });
  return Response.json(usuarios.map(u => ({
    id: u.id, nombre: u.nombre, rol: u.rol,
    areas: u.areas.map(a => a.areaCodigo),
    tieneTesa: u.areas.some(a => a.areaCodigo === AREA_TESA),
  })));
}

export async function POST() {
  const resultado = await agregarArea(SUPERVISORES, AREA_TESA);
  return Response.json({ ok: true, resultado });
}
