import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

type BitacoraEntry = { turno: string; supervisor: string; nota: string; hhAtendidas: number; fecha?: string };

function serializePrograma(
  p: Record<string, unknown> & {
    otsProgramadas?: Record<string, unknown>[];
    personal?: Record<string, unknown>[];
    resumenDias?: Record<string, unknown>[];
  },
  bitacoraMap: Record<string, BitacoraEntry[]> = {}
) {
  return {
    _id: p.id,
    semana: p.semana, anio: p.anio, disciplina: p.disciplina,
    areaCodigo: p.areaCodigo, estado: p.estado, subidoPor: p.subidoPor,
    fechaInicio: p.fechaInicio, fechaFin: p.fechaFin,
    hhDisponiblesSemana: p.hhDisponiblesSemana,
    hhProgramadasSemana: p.hhProgramadasSemana,
    hhReactivoSemana: p.hhReactivoSemana,
    otsProgramadas: (p.otsProgramadas ?? []).map((o) => {
      const isOpeplant = Boolean(o.esGuardia) || String(o.tag ?? "").includes("OPEPLANT");
      const key = isOpeplant
        ? `${String(o.numeroOT ?? "").toUpperCase()}|${String(o.grupo ?? "").toUpperCase()}`
        : null;
      return {
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
        bitacora: key && bitacoraMap[key]
          ? bitacoraMap[key]
          : (Array.isArray(o.bitacora) ? o.bitacora : []),
      };
    }),
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

  // Construir mapa de bitácora desde ReporteTurno técnicos del período
  const allFechas = programas
    .filter(p => p.fechaInicio && p.fechaFin)
    .map(p => ({ ini: p.fechaInicio as Date, fin: p.fechaFin as Date }));

  const bitacoraMap: Record<string, BitacoraEntry[]> = {};

  if (allFechas.length) {
    const minFecha = new Date(Math.min(...allFechas.map(f => f.ini.getTime())));
    const maxFecha = new Date(Math.max(...allFechas.map(f => f.fin.getTime())));

    const reportesTecnicos = await prisma.reporteTurno.findMany({
      where: { tipo: "tecnico", fecha: { gte: minFecha, lte: maxFecha } },
      select: { id: true, turno: true, fecha: true, supervisorNombre: true, otsPlanData: true },
    });

    for (const rep of reportesTecnicos) {
      const items = Array.isArray(rep.otsPlanData) ? rep.otsPlanData as Record<string, unknown>[] : [];
      const turnoUp = String(rep.turno ?? "").toUpperCase();
      for (const item of items) {
        const numOT = String(item.numeroOT ?? "").toUpperCase();
        if (!numOT) continue;
        const key = `${numOT}|${turnoUp}`;
        if (!bitacoraMap[key]) bitacoraMap[key] = [];
        bitacoraMap[key].push({
          turno: rep.turno,
          supervisor: rep.supervisorNombre ?? "",
          nota: "",
          hhAtendidas: Number(item.hhTotal) || 0,
          fecha: rep.fecha.toISOString().slice(0, 10),
        });
      }
    }
  }

  return Response.json(programas.map(p => serializePrograma(
    p as Parameters<typeof serializePrograma>[0],
    bitacoraMap
  )));
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
            bitacora: Array.isArray(o.bitacora) ? o.bitacora : [],
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
