import { prisma } from "@/lib/prisma";

// Ruta de un solo uso: borra el ProgramacionSemanal de un area/semana/anio
// puntual (con sus otsProgramadas/personal/resumenDias) desde el navegador,
// sin depender del boton "Eliminar plan existente y subir este" del modal de
// carga (que solo aparece si intentas subir un archivo nuevo). Pensada para
// corregir el programa de Chancado (areaCodigo 3310) que quedo mal atribuido
// en la semana 31/2026 por el bug de areaActiva, sin tener que subir nada en
// su lugar.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const semana = Number(searchParams.get("semana") ?? 31);
  const anio = Number(searchParams.get("anio") ?? 2026);
  const areaCodigo = searchParams.get("areaCodigo") ?? "3310";
  const confirmar = searchParams.get("confirmar") === "si";

  const programa = await prisma.programacionSemanal.findFirst({
    where: { semana, anio, areaCodigo },
    include: { otsProgramadas: { select: { numeroOT: true, tag: true, descripcionEquipo: true } } },
  });

  if (!programa) {
    return Response.json({ ok: false, error: `No hay ProgramacionSemanal para semana ${semana}/${anio}, area ${areaCodigo}` }, { status: 404 });
  }

  if (!confirmar) {
    return Response.json({
      ok: true,
      accion: "vista_previa",
      mensaje: "Agrega &confirmar=si a la URL para borrar esto de verdad.",
      id: programa.id,
      disciplina: programa.disciplina,
      areaCodigo: programa.areaCodigo,
      estado: programa.estado,
      totalOtProgramadas: programa.otsProgramadas.length,
      muestraOts: programa.otsProgramadas.slice(0, 10),
    });
  }

  await prisma.$transaction([
    prisma.otProgramada.deleteMany({ where: { programacionSemanalId: programa.id } }),
    prisma.personalSemanal.deleteMany({ where: { programacionSemanalId: programa.id } }),
    prisma.resumenDia.deleteMany({ where: { programacionSemanalId: programa.id } }),
    prisma.programacionSemanal.delete({ where: { id: programa.id } }),
  ]);

  return Response.json({ ok: true, accion: "eliminado", idEliminado: programa.id, totalOtBorradas: programa.otsProgramadas.length });
}
