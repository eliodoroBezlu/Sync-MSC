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

const MAX_PAGINAS = 2;

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
  if (y + espacio > PH - 12) { doc.addPage(); return 12; }
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

// Anchos pensados para hoja vertical (190mm útiles = 210mm A4 - 20mm de márgenes).
const COLS = [
  { header: "N° OT",                 width: 14 },
  { header: "Tipo OT",                width: 10 },
  { header: "Tipo Trabajo",           width: 11 },
  { header: "Prioridad",              width: 10 },
  { header: "Descripción de Trabajo", width: 31 },
  { header: "Equipo",                 width: 14 },
  { header: "Descripción de Equipo",  width: 24 },
  { header: "Pers.",                  width: 8 },
  { header: "Hr Trab.",               width: 8 },
  { header: "Hr Total",               width: 10 },
  { header: "Personal",               width: 50 },
];

/**
 * Plan semanal continuo, en vertical, acotado a un máximo de 2 hojas (tipo
 * hoja "I-30" del Excel de referencia): los días fluyen uno después del otro
 * en el mismo documento — sin salto de página forzado por día — igual que la
 * impresión continua de Excel. Cada día agrupa sus OTs por bloque (GRUPO
 * 1-4 / TURNO DIURNO / TURNO NOCTURNO) con una fila de UTILIZACIÓN combinada
 * al final. El tamaño de fuente/fila se calcula según el total de filas para
 * que todo entre en 2 hojas, y el texto largo (p.ej. Tipo Trabajo) se trunca
 * en una sola línea en vez de agrandar la fila. Se abre en pestaña nueva
 * (preview del visor nativo del navegador) para revisar antes de descargar.
 */
export async function generarPlanSemanalPdf(plan: Plan, cuadrilla: CuadrillaMatriz): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();

  const ots = plan.ots.filter(o => o.seleccionada || o.esGuardia);
  const reporte = calcularReporteCapacidad(ots, cuadrilla, plan.capacidadOverride, DIAS_SEMANA);

  // ── Primera pasada: arma el body de cada día y cuenta filas totales para
  // poder calcular un tamaño de fuente/fila que quepa en MAX_PAGINAS hojas.
  const diasBody: { dia: string; body: RowInput[] }[] = [];
  let totalFilas = 0;

  for (const dia of DIAS_SEMANA) {
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
      body.push([{ content: etiquetaGrupo(grupo), colSpan: COLS.length, styles: { fillColor: colores.bg, textColor: colores.texto, fontStyle: "bold", halign: "left" } }]);

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
      const filasGrupo = reporte.porGrupoDia.filter(f => f.dia === dia);
      const headcountTotal = filasGrupo.reduce((s, f) => s + f.headcount, 0);
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

    totalFilas += body.length;
    diasBody.push({ dia, body });
  }

  // ── Tamaño de fuente/fila adaptativo para acotar el documento a 2 hojas ──
  const ALTO_UTIL_POR_HOJA = PH - 14 - 9 - 3; // margen superior, pie de página, buffer
  const ALTO_BANNER = 12;
  const ALTO_BARRAS_DIA = DIAS_SEMANA.length * 7;
  const ALTO_HEADERS = DIAS_SEMANA.length * 6;
  const alturaDisponible = ALTO_UTIL_POR_HOJA * MAX_PAGINAS - ALTO_BANNER - ALTO_BARRAS_DIA - ALTO_HEADERS;
  const altoFila = Math.max(alturaDisponible / Math.max(totalFilas, 1), 2.0);
  const fontSize = Math.min(6.5, Math.max(3.0, altoFila / 1.7));
  const cellPadding = Math.min(1.4, Math.max(0.25, fontSize * 0.22));

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
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 18 }, 2: { cellWidth: "auto" }, 3: { cellWidth: 42 } },
    styles: { fontSize: 8, cellPadding: 2, lineWidth: 0.3, lineColor: NEGRO },
  });
  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  for (const { dia, body } of diasBody) {
    y = checkPage(doc, y, 16);

    doc.setFillColor(...NAVY);
    doc.rect(10, y, PW - 20, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BLANCO);
    doc.text(fechaLarga(plan.semana, plan.anio, dia), 12, y + 4.6);
    y += 6.5;

    autoTable(doc, {
      startY: y,
      margin: { left: 10, right: 10, bottom: 11, top: 12 },
      head: [COLS.map(c => c.header)],
      body,
      headStyles: { fillColor: [71, 85, 105], textColor: BLANCO, fontSize: Math.min(fontSize + 0.5, 7), fontStyle: "bold", cellPadding, halign: "center" },
      bodyStyles: { fontSize, cellPadding, textColor: NEGRO, overflow: "ellipsize", lineColor: BORDE, lineWidth: 0.2 },
      alternateRowStyles: { fillColor: GRIS_L },
      columnStyles: Object.fromEntries(COLS.map((c, i) => [i, { cellWidth: c.width, halign: [1, 2, 3, 7, 8, 9].includes(i) ? "center" as const : "left" as const }])),
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  }

  piePagina(doc, `Plan Semanal ${plan.semana}/${plan.anio}`);

  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
