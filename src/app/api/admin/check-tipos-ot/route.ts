import { prisma } from "@/lib/prisma";

// Ruta de solo lectura: audita qué valores reales tiene el campo tipoOT en
// producción, en las 3 tablas donde aparece, para decidir si se puede
// uniformar a un diccionario único (P/T/C/R) sin romper datos existentes.
export async function GET() {
  const [lineas, programadas, borrador] = await Promise.all([
    prisma.otLinea.groupBy({ by: ["tipoOT"], _count: { tipoOT: true } }),
    prisma.otProgramada.groupBy({ by: ["tipoOT"], _count: { tipoOT: true } }),
    prisma.planBorradorOt.groupBy({ by: ["tipoOT"], _count: { tipoOT: true } }),
  ]);

  const formatear = (filas: Array<{ tipoOT: string; _count: { tipoOT: number } }>) =>
    filas
      .map(f => ({ valor: f.tipoOT, cantidad: f._count.tipoOT }))
      .sort((a, b) => b.cantidad - a.cantidad);

  const muestraS = await prisma.otProgramada.findMany({
    where: { tipoOT: { in: ["S", "J"] } },
    select: { tipoOT: true, tipoTrabajo: true, numeroOT: true, descripcion: true },
    take: 15,
  });

  return Response.json({
    otLinea: formatear(lineas),
    otProgramada: formatear(programadas),
    planBorradorOt: formatear(borrador),
    muestraS,
  });
}
