import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PrintClientTecnico from "./PrintClientTecnico";

type Params = { params: Promise<{ id: string }> };

type LineaDisplay = { tag: string; tipoOT: string; descripcion: string; resolucion: string; hh: number };

type OTDisplay = {
  id: string; numeroOT: string; otJdeNumero?: string | null; tag: string; tipoOT: string;
  descripcion: string; tecnicos: string[]; hhTotal: number;
  estado: string; critica: boolean; pendiente: boolean; nota: string;
  esPlan?: boolean; esGuardia?: boolean; bitacora?: BitacoraEntry[];
  lineas?: LineaDisplay[];
};

type BitacoraEntry = { turno: string; supervisor: string; nota: string; hhAtendidas: number; fecha?: string };

type OTPlanRaw = {
  otId?: string; numeroOT: string; tag?: string;
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
  const ordenes = (reporte.otIds ?? []).length
    ? await prisma.ordenTrabajo.findMany({
        where: { id: { in: reporte.otIds } },
        include: { lineas: true, tecnicos: true },
      })
    : [];

  const otsRegistradas: OTDisplay[] = ordenes.map(o => {
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
        hh: l.tiempoRealHrs ?? 0,
      })),
    };
  });

  // ── OTs del plan semanal (guardadas inline en otsPlanData) ───────────────
  const otsPlanRaw = (reporte.otsPlanData ?? []) as OTPlanRaw[];
  const otsPlan: OTDisplay[] = otsPlanRaw.map(o => ({
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
    esGuardia: o.esGuardia ?? false,
    bitacora: o.bitacora ?? [],
  }));

  // Todas las OTs: plan primero, luego registradas
  const todasOTs = [...otsPlan, ...otsRegistradas];

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
