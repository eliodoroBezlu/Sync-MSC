import { prisma } from "@/lib/prisma";

// Ruta de solo lectura: diagnostica TODOS los ProgramacionSemanal de una
// semana/año dados (cualquier disciplina), para ver el panorama completo de
// la colisión reportada en semana 31/2026 (Eléctrico bloqueado como "ya
// existe" + áreas MEC mostrando contenido ajeno).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const semana = Number(searchParams.get("semana") ?? 31);
  const anio = Number(searchParams.get("anio") ?? 2026);

  const programas = await prisma.programacionSemanal.findMany({
    where: { semana, anio },
    include: { otsProgramadas: { select: { numeroOT: true, tag: true, descripcionEquipo: true, dia: true } } },
  });

  const areasCodigos = [...new Set(programas.map(p => p.areaCodigo).filter(Boolean))] as string[];
  const areas = await prisma.area.findMany({
    where: { codigo: { in: areasCodigos } },
    select: { codigo: true, nombre: true },
  });
  const nombrePorCodigo = new Map(areas.map(a => [a.codigo, a.nombre]));

  const resumen = programas.map(p => ({
    id: p.id,
    disciplina: p.disciplina,
    areaCodigoGuardado: p.areaCodigo,
    areaNombreGuardado: p.areaCodigo ? (nombrePorCodigo.get(p.areaCodigo) ?? "(código sin nombre registrado)") : null,
    estado: p.estado,
    subidoPor: p.subidoPor,
    totalOtProgramadas: p.otsProgramadas.length,
    muestraOts: p.otsProgramadas.slice(0, 5).map(o => ({ numeroOT: o.numeroOT, tag: o.tag, descripcionEquipo: o.descripcionEquipo, dia: o.dia })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return Response.json({ semana, anio, total: programas.length, resumen });
}
