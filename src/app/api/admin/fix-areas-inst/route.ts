import { prisma } from "@/lib/prisma";

// Supervisores que deben ver área 3351 (Contratistas bajo Instrumentación)
const SUPERVISORES_INST = ["Balladares", "Torrico"];
const AREA_INST_CONTRATISTA = "3351";

// Supervisores que deben ver área 3320 (Instrumentación)
const SUPERVISORES_ELEC = ["Viñola", "Vinola"];
const AREA_INST = "3320";

async function agregarArea(nombreFragmentos: string[], areaCodigo: string) {
  const usuarios = await prisma.usuario.findMany({
    where: { OR: nombreFragmentos.map(n => ({ nombre: { contains: n, mode: "insensitive" as const } })) },
    include: { areas: true },
  });

  return Promise.all(usuarios.map(async u => {
    const yaTiene = u.areas.some(a => a.areaCodigo === areaCodigo);
    if (yaTiene) return { id: u.id, nombre: u.nombre, accion: "sin_cambio" };

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
  const [instUsers, elecUsers] = await Promise.all([
    prisma.usuario.findMany({
      where: { OR: SUPERVISORES_INST.map(n => ({ nombre: { contains: n, mode: "insensitive" as const } })) },
      include: { areas: true },
    }),
    prisma.usuario.findMany({
      where: { OR: SUPERVISORES_ELEC.map(n => ({ nombre: { contains: n, mode: "insensitive" as const } })) },
      include: { areas: true },
    }),
  ]);

  return Response.json({
    supervisoresInst: instUsers.map(u => ({
      id: u.id, nombre: u.nombre, rol: u.rol,
      areas: u.areas.map(a => a.areaCodigo),
      tieneArea: u.areas.some(a => a.areaCodigo === AREA_INST_CONTRATISTA),
    })),
    supervisoresElec: elecUsers.map(u => ({
      id: u.id, nombre: u.nombre, rol: u.rol,
      areas: u.areas.map(a => a.areaCodigo),
      tieneArea: u.areas.some(a => a.areaCodigo === AREA_INST),
    })),
  });
}

export async function POST() {
  const [r1, r2] = await Promise.all([
    agregarArea(SUPERVISORES_INST, AREA_INST_CONTRATISTA),
    agregarArea(SUPERVISORES_ELEC, AREA_INST),
  ]);

  return Response.json({ ok: true, supervisoresInst: r1, supervisoresElec: r2 });
}
