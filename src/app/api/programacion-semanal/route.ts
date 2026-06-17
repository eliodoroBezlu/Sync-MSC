import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

function serializePrograma(p: Record<string, unknown> & {
  otsProgramadas?: Record<string, unknown>[];
  personal?: Record<string, unknown>[];
  resumenDias?: Record<string, unknown>[];
}) {
  return {
    _id: p.id,
    semana: p.semana, anio: p.anio, disciplina: p.disciplina,
    areaCodigo: p.areaCodigo, estado: p.estado, subidoPor: p.subidoPor,
    fechaInicio: p.fechaInicio, fechaFin: p.fechaFin,
    hhDisponiblesSemana: p.hhDisponiblesSemana,
    hhProgramadasSemana: p.hhProgramadasSemana,
    hhReactivoSemana: p.hhReactivoSemana,
    otsProgramadas: (p.otsProgramadas ?? []).map((o) => ({
      numeroOT: o.numeroOT, tipoOT: o.tipoOT, tipoTrabajo: o.tipoTrabajo,
      prioridad: o.prioridad, descripcion: o.descripcion, tag: o.tag,
      descripcionEquipo: o.descripcionEquipo, personas: o.personas,
      hrsTrabajo: o.hrsTrabajo, hhTotal: o.hhTotal,
      personalAsignado: o.personalAsignado, personalAsignadoIds: o.personalAsignadoIds,
      grupo: o.grupo, dia: o.dia,
      estado: o.estado, observaciones: o.observaciones,
      ordenTrabajoId: o.ordenTrabajoId, ordenTrabajoNum: o.ordenTrabajoNum,
      pasarNoche: o.pasarNoche, pasarNocheMotivo: o.pasarNocheMotivo,
      pasarNocheNota: o.pasarNocheNota, pasarNochePor: o.pasarNochePor,
      pasarNocheAt: o.pasarNocheAt, esGuardia: o.esGuardia,
    })),
    personal: (p.personal ?? []).map((per) => ({
      usuarioId: per.usuarioId, nombre: per.nombre, grupo: per.grupo,
      esContratista: per.esContratista, asistencia: per.asistencia,
    })),
    resumenDias: p.resumenDias ?? [],
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const semana     = searchParams.get("semana");
  const anio       = searchParams.get("anio");
  const disciplina = searchParams.get("disciplina");
  const estado     = searchParams.get("estado");
  const areaCodigo = searchParams.get("areaCodigo");
  const limit      = Math.min(Number(searchParams.get("limit") || "20"), 100);

  const programas = await prisma.programacionSemanal.findMany({
    where: {
      ...(semana     ? { semana: Number(semana) } : {}),
      ...(anio       ? { anio: Number(anio) }     : {}),
      ...(disciplina ? { disciplina }              : {}),
      ...(areaCodigo ? { areaCodigo }              : {}),
      ...(estado     ? { estado }                  : {}),
    },
    include: {
      otsProgramadas: searchParams.get("dia")
        ? { where: { dia: searchParams.get("dia")! } }
        : true,
      personal: true,
      resumenDias: true,
    },
    orderBy: [{ anio: "desc" }, { semana: "desc" }],
    take: limit,
  });

  return Response.json(programas.map(p => serializePrograma(p as Parameters<typeof serializePrograma>[0])));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { semana, anio, disciplina, areaCodigo, fechaInicio, fechaFin,
            personal, otsProgramadas, subidoPor } = body;

    let hhDisponiblesSemana = 0, hhProgramadasSemana = 0, hhReactivoSemana = 0;
    const diasKeys = ["Lu","Ma","Mi","Ju","Vi","Sa","Do"] as const;

    const resumenDiasData = diasKeys.map((dia, i) => {
      const fechaDia = new Date(fechaInicio);
      fechaDia.setDate(fechaDia.getDate() + i);
      const otsDelDia = (otsProgramadas ?? []).filter((o: { dia: string }) => o.dia === dia);
      const hhProg  = otsDelDia.reduce((s: number, o: { hhTotal?: number }) => s + (o.hhTotal ?? 0), 0);
      const hhReact = otsDelDia.filter((o: { tipoOT: string }) => o.tipoOT === "C")
                               .reduce((s: number, o: { hhTotal?: number }) => s + (o.hhTotal ?? 0), 0);
      const activos = (personal ?? []).filter((p: { asistencia?: { dia: string; estado: string }[] }) =>
        p.asistencia?.some((a) => a.dia === dia && ["D","N","T"].includes(a.estado))
      ).length;
      const hhDisp = activos * 10;
      hhDisponiblesSemana += hhDisp;
      hhProgramadasSemana += hhProg;
      hhReactivoSemana    += hhReact;
      return { dia, fecha: fechaDia, hhDisponibles: hhDisp, hhProgramadas: hhProg,
               utilizacion: hhDisp > 0 ? Math.round((hhProg / hhDisp) * 100) : 0 };
    });

    const existente = await prisma.programacionSemanal.findFirst({
      where: { semana, anio, areaCodigo: areaCodigo || null },
    });
    if (existente) {
      return Response.json(
        { ok: false, error: `Ya existe un plan para semana ${semana}/${anio} en esta área. Elimínalo primero si deseas reemplazarlo.` },
        { status: 409 }
      );
    }

    const programa = await prisma.programacionSemanal.create({
      data: {
        semana, anio, disciplina, areaCodigo: areaCodigo || null,
        fechaInicio: new Date(fechaInicio), fechaFin: new Date(fechaFin),
        hhDisponiblesSemana, hhProgramadasSemana, hhReactivoSemana,
        estado: "borrador", subidoPor,
        otsProgramadas: {
          create: (otsProgramadas ?? []).map((o: Record<string, unknown>) => ({
            numeroOT: String(o.numeroOT), tipoOT: String(o.tipoOT),
            tipoTrabajo: String(o.tipoTrabajo), prioridad: (o.prioridad as string) ?? null,
            descripcion: String(o.descripcion), tag: String(o.tag).toUpperCase(),
            descripcionEquipo: (o.descripcionEquipo as string) ?? "",
            personas: Number(o.personas ?? 1), hrsTrabajo: Number(o.hrsTrabajo ?? 0),
            hhTotal: Number(o.hhTotal ?? 0),
            personalAsignado: (o.personalAsignado as string[]) ?? [],
            grupo: String(o.grupo), dia: String(o.dia),
            estado: (o.estado as string) ?? "no_iniciada",
            esGuardia: Boolean(o.esGuardia),
          })),
        },
        personal: {
          create: (personal ?? []).map((p: Record<string, unknown>) => ({
            usuarioId: (p.usuarioId as string) ?? null,
            nombre: String(p.nombre), grupo: String(p.grupo),
            esContratista: Boolean(p.esContratista),
            asistencia: (p.asistencia as object) ?? [],
          })),
        },
        resumenDias: { create: resumenDiasData },
      },
      include: { otsProgramadas: true, personal: true, resumenDias: true },
    });

    return Response.json(
      { ok: true, programa: serializePrograma(programa as Parameters<typeof serializePrograma>[0]) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
