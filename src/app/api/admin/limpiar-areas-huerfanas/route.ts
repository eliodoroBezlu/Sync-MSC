import { prisma } from "@/lib/prisma";

// Áreas creadas automáticamente por la importación masiva: superintendencia vacía
// GET: lista cuáles serían eliminadas
// POST: elimina equipos de esas áreas y luego las áreas

export async function GET() {
  const candidatas = await prisma.area.findMany({
    where: { superintendencia: "" },
    include: { _count: { select: { equipos: true, usuarios: true } } },
    orderBy: { codigo: "asc" },
  });

  return Response.json({
    total: candidatas.length,
    areas: candidatas.map(a => ({
      codigo: a.codigo,
      nombre: a.nombre,
      equipos: a._count.equipos,
      usuarios: a._count.usuarios,
    })),
  });
}

export async function POST() {
  const candidatas = await prisma.area.findMany({
    where: { superintendencia: "" },
    include: { _count: { select: { usuarios: true } } },
  });

  const omitidas: { codigo: string; motivo: string }[] = [];
  const eliminadas: string[] = [];
  let equiposEliminados = 0;

  for (const a of candidatas) {
    if (a._count.usuarios > 0) {
      omitidas.push({ codigo: a.codigo, motivo: `tiene ${a._count.usuarios} usuario(s) asignado(s)` });
      continue;
    }
    // Delete equipos in this area first, then the area
    const del = await prisma.equipo.deleteMany({ where: { areaCodigo: a.codigo } });
    equiposEliminados += del.count;
    await prisma.area.delete({ where: { codigo: a.codigo } });
    eliminadas.push(a.codigo);
  }

  return Response.json({ ok: true, areasEliminadas: eliminadas.length, equiposEliminados, eliminadas, omitidas });
}
