import { prisma } from "@/lib/prisma";

// Ruta de solo lectura: diagnostica el problema de colisión de
// ProgramacionSemanal bajo la disciplina genérica "MEC" — todas las áreas
// mecánicas (Chancado, Molienda, Flotación, Filtros, Taller General,
// Contratista TTMB, Lubricación, Confiabilidad) comparten una sola fila por
// (semana, año, disciplina) en el esquema actual. Ver qué área quedó
// realmente guardada y si sus OtProgramada mezclan tags/áreas distintas.
export async function GET() {
  const [programas, borradores] = await Promise.all([
    prisma.programacionSemanal.findMany({
      where: { disciplina: "MEC" },
      include: { otsProgramadas: { select: { numeroOT: true, tag: true, descripcionEquipo: true, dia: true } } },
      orderBy: [{ anio: "desc" }, { semana: "desc" }],
    }),
    prisma.planBorrador.findMany({
      where: { disciplina: "MEC" },
      select: { id: true, semana: true, anio: true, areaCodigo: true, estado: true, programacionSemanalId: true },
      orderBy: [{ anio: "desc" }, { semana: "desc" }],
    }),
  ]);

  const areasCodigos = [...new Set(programas.map(p => p.areaCodigo).filter(Boolean))] as string[];
  const areas = await prisma.area.findMany({
    where: { codigo: { in: areasCodigos } },
    select: { codigo: true, nombre: true },
  });
  const nombrePorCodigo = new Map(areas.map(a => [a.codigo, a.nombre]));

  const resumen = programas.map(p => {
    const numerosOT = [...new Set(p.otsProgramadas.map(o => o.numeroOT))];
    return {
      id: p.id,
      semana: p.semana,
      anio: p.anio,
      areaCodigoGuardado: p.areaCodigo,
      areaNombreGuardado: p.areaCodigo ? (nombrePorCodigo.get(p.areaCodigo) ?? "(código sin nombre registrado)") : null,
      estado: p.estado,
      subidoPor: p.subidoPor,
      hhProgramadasSemana: p.hhProgramadasSemana,
      totalOtProgramadas: p.otsProgramadas.length,
      numerosOtUnicos: numerosOT.length,
      muestraOts: p.otsProgramadas.slice(0, 8).map(o => ({ numeroOT: o.numeroOT, tag: o.tag, descripcionEquipo: o.descripcionEquipo, dia: o.dia })),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });

  return Response.json({
    totalProgramasMec: programas.length,
    resumen,
    borradoresPlanificacionMec: borradores,
  });
}
