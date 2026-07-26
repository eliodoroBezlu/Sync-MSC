import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import type { Plan, CuadrillaMatriz, OtBorrador } from "@/app/planificacion/[id]/types";
import { DIAS_SEMANA, grupoDelDia } from "./cuadrillas";
import { calcularReporteCapacidad, hhPorDia } from "./capacidad";

const NAVY    = [13, 47, 94]    as [number, number, number];
const BLANCO  = [255, 255, 255] as [number, number, number];
const NEGRO   = [17, 24, 39]    as [number, number, number];
const GRIS_L  = [248, 250, 252] as [number, number, number];
const GRIS    = [107, 114, 128] as [number, number, number];
const BORDE   = [226, 232, 240] as [number, number, number];
const VERDE   = [0, 176, 80]    as [number, number, number];
const AMARILLO = [255, 217, 0]  as [number, number, number];
const NARANJA_GRUPO = [237, 125, 49] as [number, number, number];
const AZUL_DIURNO   = [189, 215, 238] as [number, number, number];
const AZUL_NOCTURNO = [142, 169, 219] as [number, number, number];

const GRUPOS_ORDEN = ["G1", "G2", "G3", "G4", "Diurno", "Nocturno"];

function colorDeGrupo(grupo: string): { bg: [number, number, number]; texto: [number, number, number] } {
  if (grupo === "Diurno") return { bg: AZUL_DIURNO, texto: NEGRO };
  if (grupo === "Nocturno") return { bg: AZUL_NOCTURNO, texto: NEGRO };
  return { bg: NARANJA_GRUPO, texto: BLANCO };
}

function etiquetaGrupo(grupo: string): string {
  if (grupo === "Diurno") return "TURNO DIURNO";
  if (grupo === "Nocturno") return "TURNO NOCTURNO";
  return `GRUPO ${grupo.replace(/^G/, "")}`;
}

const DIA_NOMBRE: Record<string, string> = {
  Lu: "lunes", Ma: "martes", Mi: "miércoles", Ju: "jueves", Vi: "viernes", Sa: "sábado", Do: "domingo",
};

function fechaLarga(semana: number, anio: number, diaCodigo: string): string {
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  const offset = DIAS_SEMANA.indexOf(diaCodigo);
  const fecha = new Date(lunes);
  fecha.setDate(lunes.getDate() + offset);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${DIA_NOMBRE[diaCodigo]}, ${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function checkPage(doc: jsPDF, y: number, espacio: number): number {
  const PH = doc.internal.pageSize.getHeight();
  if (y + espacio > PH - 12) { doc.addPage(); return 14; }
  return y;
}

function piePagina(doc: jsPDF, titulo: string) {
  const totalPages = doc.getNumberOfPages();
  const PW = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const PH = doc.internal.pageSize.getHeight();
    doc.setFillColor(...NAVY);
    doc.rect(0, PH - 9, PW, 9, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...BLANCO);
    doc.text(`SYNC MSC · ${titulo} · Generado ${new Date().toLocaleDateString("es-BO")}`, 10, PH - 3.2);
    doc.text(`Pág. ${i} / ${totalPages}`, PW - 10, PH - 3.2, { align: "right" });
  }
}

const COLS = [
  { header: "N° OT",                 width: 20 },
  { header: "Tipo OT",                width: 14 },
  { header: "Tipo Trabajo",           width: 16 },
  { header: "Prioridad",              width: 14 },
  { header: "Descripción de Trabajo", width: 45 },
  { header: "Equipo",                 width: 20 },
  { header: "Descripción de Equipo",  width: 35 },
  { header: "Pers.",                  width: 12 },
  { header: "Hr Trab.",               width: 12 },
  { header: "Hr Total",               width: 14 },
  { header: "Personal",               width: 75 },
];

/**
 * Plan semanal continuo (tipo hoja "I-30" del Excel de referencia): los días
 * fluyen uno después del otro en el mismo documento — sin salto de página
 * forzado por día — igual que la impresión continua de Excel. Cada día
 * agrupa sus OTs por bloque (GRUPO 1-4 / TURNO DIURNO / TURNO NOCTURNO) con
 * una fila de UTILIZACIÓN combinada al final del día. Se abre en pestaña
 * nueva (preview del visor nativo del navegador) para revisar antes de
 * descargar.
 */
export async function generarPlanSemanalPdf(plan: Plan, cuadrilla: CuadrillaMatriz): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();

  const ots = plan.ots.filter(o => o.seleccionada || o.esGuardia);
  const reporte = calcularReporteCapacidad(ots, cuadrilla, plan.capacidadOverride, DIAS_SEMANA);

  // ── Banner superior: Semana | fecha corta | título | etiqueta ─────────────
  autoTable(doc, {
    startY: 10,
    margin: { left: 10, right: 10 },
    theme: "plain",
    body: [[
      { content: "Semana", styles: { fillColor: VERDE, textColor: BLANCO, fontStyle: "bold", halign: "center" } },
      { content: `${plan.semana} / ${String(plan.anio).slice(-2)}`, styles: { fillColor: AMARILLO, textColor: NEGRO, fontStyle: "bold", halign: "center" } },
      { content: `PROGRAMA SEMANAL ${plan.disciplina.toUpperCase()} ${plan.areaCodigo.toUpperCase()}`, styles: { fillColor: AMARILLO, textColor: NEGRO, fontStyle: "bold", halign: "center" } },
      { content: "Programación Semanal", styles: { fillColor: VERDE, textColor: BLANCO, fontStyle: "bold", halign: "center" } },
    ]],
    columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 24 }, 2: { cellWidth: "auto" }, 3: { cellWidth: 55 } },
    styles: { fontSize: 10, cellPadding: 2.6, lineWidth: 0.3, lineColor: NEGRO },
  });
  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  for (const dia of DIAS_SEMANA) {
    y = checkPage(doc, y, 20);

    doc.setFillColor(...NAVY);
    doc.rect(10, y, PW - 20, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...BLANCO);
    doc.text(fechaLarga(plan.semana, plan.anio, dia), 13, y + 5);
    y += 7;

    const body: RowInput[] = [];
    let huboContenido = false;

    for (const grupo of GRUPOS_ORDEN) {
      const otsDelBlock = ots
        .filter(o => o.dias.includes(dia) && grupoDelDia(o, dia) === grupo)
        .sort((a, b) => a.numeroOT.localeCompare(b.numeroOT, undefined, { numeric: true }));
      const cap = reporte.porGrupoDia.find(f => f.grupo === grupo && f.dia === dia);
      if (otsDelBlock.length === 0 && (!cap || cap.headcount === 0)) continue;

      huboContenido = true;
      const colores = colorDeGrupo(grupo);
      body.push([{ content: etiquetaGrupo(grupo), colSpan: COLS.length, styles: { fillColor: colores.bg, textColor: colores.texto, fontStyle: "bold", halign: "left", fontSize: 8 } }]);

      const nombresGrupoDia = new Set((cuadrilla[grupo]?.[dia] ?? []).map(t => t.nombre));
      if (otsDelBlock.length === 0) {
        body.push([{ content: "Sin OTs asignadas", colSpan: COLS.length, styles: { halign: "center", textColor: GRIS, fontStyle: "italic" } }]);
      } else {
        for (const ot of otsDelBlock as OtBorrador[]) {
          body.push([
            ot.numeroOT,
            ot.tipoOT,
            ot.tipoTrabajo,
            ot.prioridad ?? "—",
            ot.descripcion,
            ot.tag,
            ot.descripcionEquipo,
            String(ot.personas),
            String(ot.hrsTrabajo),
            fmtNum(hhPorDia(ot, dia)),
            ot.personalAsignado.filter(n => nombresGrupoDia.has(n)).join(" / ") || "—",
          ]);
        }
      }
    }

    if (huboContenido) {
      const filas = reporte.porGrupoDia.filter(f => f.dia === dia);
      const headcountTotal = filas.reduce((s, f) => s + f.headcount, 0);
      const diaResumen = reporte.porDia.find(d => d.dia === dia);
      const pct = diaResumen ? Math.round(diaResumen.utilizacion * 100) : 0;
      const estiloUtil = { fillColor: VERDE, textColor: BLANCO, fontStyle: "bold" as const };
      body.push([
        { content: "UTILIZACIÓN", colSpan: 7, styles: { ...estiloUtil, halign: "left" } },
        { content: String(headcountTotal), styles: { ...estiloUtil, halign: "center" } },
        { content: fmtNum(diaResumen?.horasDisponibles ?? 0), styles: { ...estiloUtil, halign: "center" } },
        { content: fmtNum(diaResumen?.horasProgramadas ?? 0), styles: { ...estiloUtil, halign: "center" } },
        { content: `${pct}%`, styles: { ...estiloUtil, halign: "center" } },
      ]);
    } else {
      body.push([{ content: "Sin actividad programada este día", colSpan: COLS.length, styles: { halign: "center", textColor: GRIS, fontStyle: "italic" } }]);
    }

    autoTable(doc, {
      startY: y,
      margin: { left: 10, right: 10, bottom: 11 },
      head: [COLS.map(c => c.header)],
      body,
      headStyles: { fillColor: [71, 85, 105], textColor: BLANCO, fontSize: 6.5, fontStyle: "bold", cellPadding: 1.6, halign: "center" },
      bodyStyles: { fontSize: 6.5, cellPadding: 1.6, textColor: NEGRO, overflow: "linebreak", lineColor: BORDE, lineWidth: 0.2 },
      alternateRowStyles: { fillColor: GRIS_L },
      columnStyles: Object.fromEntries(COLS.map((c, i) => [i, { cellWidth: c.width, halign: [1, 2, 3, 7, 8, 9].includes(i) ? "center" as const : "left" as const }])),
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  }

  piePagina(doc, `Plan Semanal ${plan.semana}/${plan.anio}`);

  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
