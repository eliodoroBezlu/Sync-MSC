import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrintClientTecnico from "./PrintClientTecnico";

type Params = { params: Promise<{ id: string }> };

type LineaDisplay = { tag: string; tipoOT: string; descripcion: string; resolucion: string; estadoFinal?: string; hh: number; observaciones?: string; tareasEjecutadas?: string[]; descripcionTrabajo?: string };

type OTDisplay = {
  id: string; numeroOT: string; otJdeNumero?: string | null; tag: string; tipoOT: string;
  descripcion: string; tecnicos: string[]; hhTotal: number;
  estado: string; critica: boolean; pendiente: boolean; nota: string;
  esPlan?: boolean; esGuardia?: boolean; bitacora?: BitacoraEntry[];
  lineas?: LineaDisplay[];
};

type BitacoraEntry = { turno: string; supervisor: string; nota: string; resolucion?: string; estadoFinal?: string; hhAtendidas: number; fecha?: string };

type OTPlanRaw = {
  otId?: string; ordenTrabajoId?: string | null; numeroOT: string; tag?: string;
  tipoOT?: string; descripcion?: string; tecnicos?: string[];
  hhTotal?: number; estado?: string; esGuardia?: boolean;
  bitacora?: BitacoraEntry[];
  disciplina?: string;
};

export default async function ImprimirReporteTecnicoPage({ params }: Params) {
  const { id } = await params;
  const reporte = await prisma.reporteTurno.findUnique({ where: { id } });
  if (!reporte) notFound();

  const criticas   = new Set(reporte.otsCriticas ?? []);
  const pendientes = new Set(reporte.otsPendientesSiguienteTurno ?? []);
  const notasArr   = (reporte.notasOTs ?? []) as { otId: string; nota: string }[];
  const notasMap   = new Map(notasArr.map(n => [n.otId, n.nota]));

  // ── OTs registradas en el sistema ────────────────────────────────────────
  function mapOrdenToDisplay(o: {
    id: string; numeroOT: string; otJdeNumero: string | null; estado: string;
    tecnicos: { nombreCompleto: string }[];
    lineas: { tag: string; tipoOT: string; sintoma: string | null; descripcionEquipo: string | null; descripcionTrabajo: string | null; tiempoRealHrs: number | null; observaciones: string | null; tareasEjecutadas: string[] }[];
  }): OTDisplay {
    const linea = o.lineas[0];
    const hhTotal = o.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
    return {
      id: o.id,
      numeroOT: o.numeroOT,
      otJdeNumero: o.otJdeNumero,
      tag: linea?.tag ?? "",
      tipoOT: linea?.tipoOT ?? "",
      descripcion: linea?.sintoma ?? linea?.descripcionEquipo ?? linea?.descripcionTrabajo ?? "",
      tecnicos: o.tecnicos.map(t => t.nombreCompleto),
      hhTotal,
      estado: o.estado,
      critica: criticas.has(o.id),
      pendiente: pendientes.has(o.id),
      nota: notasMap.get(o.id) ?? "",
      esPlan: false,
      lineas: o.lineas.map(l => ({
        tag: l.tag,
        tipoOT: l.tipoOT,
        descripcion: l.sintoma ?? l.descripcionEquipo ?? l.descripcionTrabajo ?? "",
        resolucion: (l as Record<string, unknown>).resolucionAplicada as string ?? "",
        estadoFinal: (l as Record<string, unknown>).estadoFinal as string ?? undefined,
        hh: l.tiempoRealHrs ?? 0,
        observaciones: l.observaciones ?? undefined,
        tareasEjecutadas: l.tareasEjecutadas ?? [],
        descripcionTrabajo: l.descripcionTrabajo ?? undefined,
      })),
    };
  }

  const ordenes = (reporte.otIds ?? []).length
    ? await prisma.ordenTrabajo.findMany({
        where: { id: { in: reporte.otIds } },
        include: { lineas: true, tecnicos: true },
      })
    : [];

  // ── OTs del plan semanal (guardadas inline en otsPlanData) ───────────────
  const otsPlanRaw = (reporte.otsPlanData ?? []) as OTPlanRaw[];

  // El flag esGuardia casi nunca queda seteado en BD; el tag "OPEPLANT" es la
  // señal confiable (mismo criterio que registro/turnero/semanales).
  function esOpeplant(o: OTPlanRaw): boolean {
    return !!o.esGuardia || String(o.tag ?? "").includes("OPEPLANT");
  }

  // Para OTs OPEPLANT, buscar OTs hijas registradas por los turneros en este
  // mismo día y turno — se muestran como CMR/CMP normales (una fila por
  // hija), no fusionadas dentro de la fila de plan. Excluye las que el
  // técnico ya seleccionó a mano (otIds) para no duplicarlas.
  const guardiaNumeros = otsPlanRaw
    .filter(o => esOpeplant(o))
    .map(o => o.numeroOT)
    .filter(Boolean);

  // Rango de día calculado en UTC. reporte.fecha y la fecha de las hijas se
  // guardan a partir de un string "YYYY-MM-DD" que Date interpreta como
  // medianoche UTC; acotar con setHours/setDate (que usan la zona horaria
  // del proceso) desplaza el límite en servidores fuera de UTC y excluye
  // hijas de turnos Nocturno que cruzan medianoche.
  const diaReporte = new Date(reporte.fecha);
  const inicioDia = new Date(Date.UTC(diaReporte.getUTCFullYear(), diaReporte.getUTCMonth(), diaReporte.getUTCDate()));
  const finDia = new Date(Date.UTC(diaReporte.getUTCFullYear(), diaReporte.getUTCMonth(), diaReporte.getUTCDate() + 1));

  const childOTs = guardiaNumeros.length > 0
    ? await prisma.ordenTrabajo.findMany({
        where: {
          otJdeNumero: { in: guardiaNumeros },
          parentOtId: { not: null },
          turno: reporte.turno,
          fecha: { gte: inicioDia, lt: finDia },
          id: { notIn: reporte.otIds ?? [] },
        },
        include: { lineas: true, tecnicos: true },
      })
    : [];

  const otsRegistradas: OTDisplay[] = [...ordenes, ...childOTs].map(mapOrdenToDisplay);

  // Para OTs del plan normales (no OPEPLANT), cargar sus líneas desde la DB
  // Preferir ordenTrabajoId (nuevo); fallback por numeroOT (reportes guardados antes del fix)
  const planNormales = otsPlanRaw.filter(o => !esOpeplant(o));
  const planPorId = planNormales.filter(o => o.ordenTrabajoId).map(o => o.ordenTrabajoId as string);
  const planPorNum = planNormales.filter(o => !o.ordenTrabajoId && o.numeroOT).map(o => o.numeroOT);

  const planOTsDB = (planPorId.length > 0 || planPorNum.length > 0)
    ? await prisma.ordenTrabajo.findMany({
        where: { OR: [
          ...(planPorId.length > 0 ? [{ id: { in: planPorId } }] : []),
          ...(planPorNum.length > 0 ? [{ numeroOT: { in: planPorNum } }] : []),
        ]},
        include: { lineas: true },
      })
    : [];

  // Indexar por id y por numeroOT para lookup eficiente
  const planLineasById  = new Map(planOTsDB.map(o => [o.id, o.lineas]));
  const planLineasByNum = new Map(planOTsDB.map(o => [o.numeroOT, o.lineas]));
  function getPlanLineas(o: OTPlanRaw) {
    if (o.ordenTrabajoId && planLineasById.has(o.ordenTrabajoId)) return planLineasById.get(o.ordenTrabajoId)!;
    if (planLineasByNum.has(o.numeroOT)) return planLineasByNum.get(o.numeroOT)!;
    return null;
  }

  const otsPlan: OTDisplay[] = otsPlanRaw.map(o => {
    let planLineas: LineaDisplay[] | undefined = undefined;

    // OT plan normal: cargar lineas desde DB para mostrar resolución.
    // Las OPEPLANT nunca traen sus líneas por acá — si ya tienen hijas
    // registradas, el deduplicado en PrintClientTecnico las excluye de esta
    // sección porque el numeroOT ya aparece en otsRegistradas.
    const dbLineas = !esOpeplant(o) ? getPlanLineas(o) : null;
    if (dbLineas && dbLineas.length > 0) {
      planLineas = dbLineas.map(l => ({
          tag: l.tag,
          tipoOT: l.tipoOT,
          descripcion: l.sintoma ?? l.descripcionEquipo ?? l.descripcionTrabajo ?? "",
          resolucion: (l as Record<string, unknown>).resolucionAplicada as string ?? "",
          estadoFinal: (l as Record<string, unknown>).estadoFinal as string ?? undefined,
          hh: l.tiempoRealHrs ?? 0,
          observaciones: l.observaciones ?? undefined,
        tareasEjecutadas: l.tareasEjecutadas ?? [],
        descripcionTrabajo: l.descripcionTrabajo ?? undefined,
        }));
    }

    return {
      id: o.otId ?? `plan-${o.numeroOT}`,
      numeroOT: o.numeroOT,
      tag: o.tag ?? "",
      tipoOT: o.tipoOT ?? "",
      descripcion: o.descripcion ?? "",
      tecnicos: o.tecnicos ?? [],
      hhTotal: o.hhTotal ?? 0,
      estado: o.estado ?? "completada",
      critica: criticas.has(o.otId ?? ""),
      pendiente: pendientes.has(o.otId ?? ""),
      nota: notasMap.get(o.otId ?? "") ?? "",
      esPlan: true,
      esGuardia: esOpeplant(o),
      bitacora: o.bitacora ?? [],
      lineas: planLineas,
    };
  });

  // Todas las OTs: plan primero, luego registradas. Deduplicar entradas de
  // plan (p.ej. OPEPLANT) cuyo numero ya aparece entre las registradas —
  // mismo criterio que usa PrintClientTecnico para la tabla — para que el
  // resumen ejecutivo no cuente esa OT dos veces (una como plan, otra como
  // registrada) cuando en la tabla impresa solo se ve una vez.
  const numerosRegistrados = new Set(otsRegistradas.map(o => o.otJdeNumero ?? o.numeroOT));
  const otsPlanDeduplicadas = otsPlan.filter(o => !numerosRegistrados.has(o.otJdeNumero ?? o.numeroOT));
  const todasOTs = [...otsPlanDeduplicadas, ...otsRegistradas];

  // Calcular resumen
  const totalHH = todasOTs.reduce((s, o) => s + o.hhTotal, 0);
  const correctivos = todasOTs.filter(o => ["CMP","CMR"].includes(o.tipoOT)).length;
  const preventivos = todasOTs.filter(o => !["CMP","CMR"].includes(o.tipoOT) && o.tipoOT).length;
  const concluidas  = otsRegistradas.filter(o => ["concluido","revisado","completada"].includes(o.estado)).length;

  const reporteData = {
    _id: reporte.id,
    turno: reporte.turno,
    fecha: reporte.fecha ? new Date(reporte.fecha).toISOString() : "",
    tecnicoNombre: reporte.supervisorNombre,
    resumenEjecutivo: {
      totalOTs: todasOTs.length,
      concluidas,
      pendientes: todasOTs.filter(o => o.pendiente).length,
      hhTotales: Math.round(totalHH * 10) / 10,
      correctivos,
      preventivos,
    },
    novedades: (reporte.recomendaciones ?? []) as { prioridad: string; tag?: string; descripcion: string }[],
  };

  return <PrintClientTecnico reporte={reporteData} ots={todasOTs} />;
}
