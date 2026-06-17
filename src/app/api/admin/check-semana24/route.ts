import { prisma } from "@/lib/prisma";

export async function GET() {
  const planes = await prisma.programacionSemanal.findMany({
    where: { semana: 24, anio: 2026 },
    orderBy: { createdAt: "asc" },
  });

  const codigosPlanes = [...new Set(planes.map(p => p.areaCodigo).filter(Boolean))] as string[];

  const areasExistentes = await prisma.area.findMany({
    where: { codigo: { in: codigosPlanes } },
    select: { codigo: true, nombre: true, superintendencia: true },
  });

  const setExistentes = new Set(areasExistentes.map(a => a.codigo));

  const resumen = codigosPlanes.map(codigo => ({
    areaCodigo: codigo,
    existe: setExistentes.has(codigo),
    planesCount: planes.filter(p => p.areaCodigo === codigo).length,
    area: areasExistentes.find(a => a.codigo === codigo) ?? null,
  }));

  const planesSinArea = planes.filter(p => !p.areaCodigo).map(p => ({
    id: p.id,
    disciplina: p.disciplina,
    areaCodigo: p.areaCodigo,
  }));

  return Response.json({
    semana: 24,
    anio: 2026,
    totalPlanes: planes.length,
    codigosUnicos: codigosPlanes.length,
    planesSinArea,
    sinArea: resumen.filter(r => !r.existe),
    conArea: resumen.filter(r => r.existe),
  });
}

// Mapeo disciplina → areaCodigo para corregir planes sin área
const DISCIPLINA_A_AREA: Record<string, string> = {
  INST:   "3320",
  ELEC:   "3319",
  TESA:   "3348",
  TELECO: "3351",
};

export async function POST() {
  const planes = await prisma.programacionSemanal.findMany({
    where: { semana: 24, anio: 2026 },
  });

  const actualizados: { id: string; disciplina: string; areaCodigo: string }[] = [];
  const sinMapeo: { id: string; disciplina: string }[] = [];

  for (const p of planes) {
    if (p.areaCodigo) continue; // ya tiene área, saltar
    const codigo = DISCIPLINA_A_AREA[p.disciplina ?? ""];
    if (!codigo) { sinMapeo.push({ id: p.id, disciplina: p.disciplina ?? "" }); continue; }
    await prisma.programacionSemanal.update({
      where: { id: p.id },
      data: { areaCodigo: codigo },
    });
    actualizados.push({ id: p.id, disciplina: p.disciplina ?? "", areaCodigo: codigo });
  }

  return Response.json({ ok: true, actualizados, sinMapeo });
}
