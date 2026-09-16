import { jsPDF } from "jspdf";
import autoTable, { type CellHookData, type RowInput } from "jspdf-autotable";
import { tipoOtDisplay } from "@/lib/tiposOt";
import type { BitacoraEntry, LineaDisplay, Novedad, OTDisplay, ReporteData } from "@/app/ordenes/turno-tecnico/[id]/imprimir/PrintClientTecnico";

// ── Paleta (misma que la vista de impresión, PrintClientTecnico.tsx) ──────────
const NAVY      = [31, 56, 100]   as [number, number, number]; // #1f3864
const AZUL      = [37, 99, 235]   as [number, number, number]; // #2563eb
const VERDE     = [22, 163, 74]   as [number, number, number]; // #16a34a
const AMBAR     = [217, 119, 6]   as [number, number, number]; // #d97706
const ROJO      = [220, 38, 38]   as [number, number, number]; // #dc2626
const CIAN      = [8, 145, 178]   as [number, number, number]; // #0891b2
const GRIS      = [107, 114, 128] as [number, number, number]; // #6b7280
const NEGRO     = [17, 24, 39]    as [number, number, number]; // #111827
const BLANCO    = [255, 255, 255] as [number, number, number];
const AZUL_OSC  = [30, 64, 175]   as [number, number, number]; // #1e40af (títulos sección plan)
const VERDE_OSC = [22, 101, 52]   as [number, number, number]; // #166534 (título sección registradas)
const AMBAR_OSC = [146, 64, 14]   as [number, number, number]; // #92400e (bitácora/opeplant)

const BG_PLAN       = [219, 234, 254] as [number, number, number]; // #dbeafe
const BG_REGISTRO   = [240, 253, 244] as [number, number, number]; // #f0fdf4
const BG_PLAN_FILA   = [248, 250, 252] as [number, number, number]; // #f8fafc
const BG_CRITICA     = [255, 241, 242] as [number, number, number]; // #fff1f2
const BG_GUARDIA     = [255, 251, 235] as [number, number, number]; // #fffbeb
const BG_MULTILINEA  = [232, 240, 254] as [number, number, number]; // #e8f0fe

const ESTADO_FINAL_LABEL: Record<string, string> = {
  operativo:      "Operativo",
  operativo_obs:  "Operativo c/ observación",
  pendiente:      "Pendiente",
  fuera_servicio: "Fuera de servicio",
};

// Anchos de columna (mm) de la tabla principal, proporcionales a los anchos
// en px definidos en PrintClientTecnico.tsx, escalados al ancho de página
// disponible en A4 horizontal con margen de 10mm (297 - 20 = 277mm).
const COL = { item: 8, tipo: 16, tag: 23, hrs: 8, otNum: 17, desc: 107, tareas: 81, estado: 17 };
const MARGIN = 10;

function otNum(ot: OTDisplay): string {
  return ot.otJdeNumero ?? ot.numeroOT;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Descarga la imagen del logo como data URL para incrustarla con addImage.
// Si falla (ruta no disponible, red, etc.) se omite el logo sin romper el PDF.
function cargarImagenComoDataUrl(url: string): Promise<string | null> {
  return new Promise(resolve => {
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error("logo no disponible"))))
      .then(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });
}

function checkPage(doc: jsPDF, y: number, espacio: number): number {
  const PH = doc.internal.pageSize.getHeight();
  if (y + espacio > PH - 14) {
    doc.addPage();
    return 15;
  }
  return y;
}

function piePagina(doc: jsPDF, tecnico: string) {
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
    doc.text(`SYNC MSC · Reporte de Turno — ${tecnico} · Generado ${new Date().toLocaleDateString("es-BO")}`, MARGIN, PH - 3.2);
    doc.text(`Pág. ${i} / ${totalPages}`, PW - MARGIN, PH - 3.2, { align: "right" });
  }
}

// Texto de una línea/entrada de bitácora para la columna DESCRIPCIÓN,
// incluyendo la resolución y la etiqueta de estado final si existe.
//
// Nota: las fuentes estándar de jsPDF (helvetica) sólo soportan el charset
// WinAnsi/cp1252. Símbolos fuera de ese charset (✓, ⚠, →, etc.) no tienen un
// ancho de glifo válido, lo que rompe el cálculo de saltos de línea de
// autoTable y deja el texto de la celda con las letras separadas/desalineadas.
// Por eso acá (y en el resto del archivo) se usa sólo texto plano, igual que
// en generarInformeOT.ts.
function textoDescripcion(descripcion: string | undefined, resolucion: string | undefined, estadoFinal: string | undefined): string {
  const partes = [descripcion || "—"];
  if (resolucion) {
    const label = estadoFinal ? ESTADO_FINAL_LABEL[estadoFinal] : undefined;
    partes.push(`Resuelto: ${resolucion}${label ? ` [${label}]` : ""}`);
  }
  return partes.join("\n");
}

function textoTareas(tareas: string[] | undefined, fallback: string | undefined): string {
  if (tareas && tareas.length > 0) return tareas.map(t => `• ${t}`).join("\n");
  return fallback?.trim() || "—";
}

type FilaMeta = { fill?: [number, number, number] };

/**
 * Genera y descarga el PDF del reporte de turno del técnico con texto real
 * (dibujado con jsPDF + jspdf-autotable), no una imagen del DOM — a
 * diferencia de la versión anterior basada en html2pdf.js, el archivo
 * resultante se puede seleccionar y copiar en lectores como Adobe Reader.
 * Reproduce el mismo contenido y estructura visual que la vista de
 * impresión (PrintClientTecnico.tsx): encabezado, KPIs, tabla de OTs por
 * secciones (plan de turno / registradas en sistema), novedades y
 * OTs críticas/pendientes para el siguiente turno.
 */
export async function generarReporteTurnoTecnicoPdf(reporte: ReporteData, ots: OTDisplay[]): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const res = reporte.resumenEjecutivo;

  const criticas = ots.filter(o => o.critica);
  const pendientesSig = ots.filter(o => o.pendiente);

  const otsRegistradas = ots.filter(o => !o.esPlan);
  const numerosRegistrados = new Set(otsRegistradas.map(o => o.otJdeNumero ?? o.numeroOT));
  const otsPlan = ots.filter(o => o.esPlan && !numerosRegistrados.has(o.otJdeNumero ?? o.numeroOT));
  const otsPlanBitacora = otsPlan.filter(o => o.esGuardia && o.bitacora && o.bitacora.length > 0);
  const otsPlanResto = otsPlan.filter(o => !(o.esGuardia && o.bitacora && o.bitacora.length > 0));

  let y = 10;

  // ── ENCABEZADO ────────────────────────────────────────────────────────────
  const logoDataUrl = await cargarImagenComoDataUrl("/logo-msc.png");
  const hEnc = 22;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN, y, PW - MARGIN * 2, hEnc, "S");
  doc.line(MARGIN + 30, y, MARGIN + 30, y + hEnc);
  doc.line(PW - MARGIN - 42, y, PW - MARGIN - 42, y + hEnc);

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "PNG", MARGIN + 4, y + 4, 22, hEnc - 8); } catch { /* logo opcional */ }
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NAVY);
    doc.text("MSC", MARGIN + 15, y + hEnc / 2 + 2, { align: "center" });
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...NEGRO);
  doc.text("REPORTE DE TURNO — TÉCNICO / TURNERO", MARGIN + 30 + (PW - MARGIN * 2 - 72) / 2, y + hEnc / 2 + 2, { align: "center" });

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...NEGRO);
  doc.text("2.03.P01.F36", PW - MARGIN - 21, y + 7, { align: "center" });
  doc.text("Revisión: 1", PW - MARGIN - 21, y + 11.5, { align: "center" });
  doc.setFillColor(184, 184, 184);
  doc.rect(PW - MARGIN - 42, y + hEnc - 6, 42, 6, "F");
  doc.setDrawColor(0, 0, 0);
  doc.rect(PW - MARGIN - 42, y + hEnc - 6, 42, 6, "S");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("INTERNA", PW - MARGIN - 21, y + hEnc - 2, { align: "center" });

  y += hEnc + 2;

  // ── SUBENCABEZADO ─────────────────────────────────────────────────────────
  const hSub = 7;
  const wSub = [0.22, 0.34, 0.16, 0.28].map(p => p * (PW - MARGIN * 2));
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, PW - MARGIN * 2, hSub, "S");
  let xSub = MARGIN;
  const subCeldas: [string, string][] = [
    ["Gerencia:", "Mantenimiento Planta"],
    ["Técnico / Turnero:", reporte.tecnicoNombre],
    ["Turno:", reporte.turno],
    ["Fecha:", fmtFecha(reporte.fecha)],
  ];
  subCeldas.forEach(([label, valor], i) => {
    if (i > 0) doc.line(xSub, y, xSub, y + hSub);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...NEGRO);
    const labelW = doc.getTextWidth(label + " ");
    doc.text(label, xSub + 2, y + hSub / 2 + 1.3);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(valor, wSub[i] - labelW - 4), xSub + 2 + labelW, y + hSub / 2 + 1.3);
    xSub += wSub[i];
  });
  y += hSub + 3;

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis: { val: number; lbl: string; color: [number, number, number] }[] = [
    { val: res.totalOTs, lbl: "Total OTs", color: NAVY },
    { val: res.concluidas, lbl: "Completadas", color: VERDE },
    { val: res.pendientes, lbl: "Pasan a sgtte", color: AMBAR },
    { val: res.hhTotales, lbl: "HH Totales", color: AZUL },
    { val: res.correctivos, lbl: "Correctivos", color: ROJO },
    { val: res.preventivos, lbl: "Preventivos", color: CIAN },
  ];
  const wKpi = (PW - MARGIN * 2 - 5 * 2) / 6;
  const hKpi = 13;
  kpis.forEach((k, i) => {
    const xK = MARGIN + i * (wKpi + 2);
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
    doc.rect(xK, y, wKpi, hKpi, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...k.color);
    doc.text(String(k.val), xK + wKpi / 2, y + 7, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...GRIS);
    doc.text(k.lbl, xK + wKpi / 2, y + 11, { align: "center" });
  });
  y += hKpi + 3;

  // ── TABLA PRINCIPAL DE OTs ────────────────────────────────────────────────
  const body: RowInput[] = [];
  const filaMeta: FilaMeta[] = [];
  const push = (fila: RowInput, meta: FilaMeta = {}) => { body.push(fila); filaMeta.push(meta); };

  const filaSeccion = (texto: string, fill: [number, number, number], color: [number, number, number]) => {
    push([{ content: texto, colSpan: 8, styles: { fillColor: fill, textColor: color, fontStyle: "bold", fontSize: 8, halign: "left" } }]);
  };

  if (otsPlanResto.length > 0) {
    const hhPlan = otsPlanResto.reduce((s, o) => s + o.hhTotal, 0);
    filaSeccion(`PLAN DE TURNO — ${reporte.turno.toUpperCase()} (${otsPlanResto.length} OT${otsPlanResto.length !== 1 ? "s" : ""} · ${hhPlan} HH)`, BG_PLAN, AZUL_OSC);
  }

  otsPlanResto.forEach((ot, idx) => {
    const lineas = ot.lineas && ot.lineas.length > 0 ? ot.lineas : null;
    const bgPlan: [number, number, number] = ot.critica ? BG_CRITICA : BG_PLAN_FILA;

    if (lineas && lineas.length > 1) {
      push([
        { content: String(idx + 1), styles: { halign: "center", fontStyle: "bold" } },
        { content: `OT ${otNum(ot)} · ${ot.descripcion || "—"}`, colSpan: 4, styles: { fontStyle: "bold", textColor: AZUL_OSC } },
        { content: ot.nota || "—", colSpan: 2, styles: { fontStyle: ot.nota ? "normal" : "italic", textColor: ot.nota ? NEGRO : GRIS } },
        { content: "PLAN", styles: { halign: "center", fontStyle: "bold", textColor: VERDE } },
      ], { fill: BG_PLAN });
      lineas.forEach((l: LineaDisplay, li: number) => {
        push([
          { content: `${idx + 1}.${li + 1}`, styles: { halign: "center", fontSize: 7, textColor: GRIS } },
          `${tipoOtDisplay(l.tipoOT || ot.tipoOT).texto}\n(PLAN)`,
          l.tag,
          { content: l.hh ? String(l.hh) : "—", styles: { halign: "center" } },
          otNum(ot),
          textoDescripcion(l.descripcion, l.resolucion, l.estadoFinal),
          { content: textoTareas(l.tareasEjecutadas, l.descripcionTrabajo), colSpan: 2 },
        ], { fill: bgPlan });
      });
      return;
    }

    const linea0 = lineas?.[0];
    const textoTareasCol = linea0?.tareasEjecutadas && linea0.tareasEjecutadas.length > 0
      ? textoTareas(linea0.tareasEjecutadas, undefined)
      : (ot.nota || linea0?.descripcionTrabajo || "—");
    const alertas = [ot.critica ? "CRÍTICA" : "", ot.pendiente ? "PASA A SGTE. TURNO" : ""].filter(Boolean).join("  ");

    push([
      { content: String(idx + 1), styles: { halign: "center" } },
      `${ot.tipoOT ? tipoOtDisplay(ot.tipoOT).texto : "—"}\n(${ot.esGuardia ? "OPEPLANT" : "PLAN"})`,
      linea0?.tag || ot.tag || "—",
      { content: String(linea0?.hh || ot.hhTotal || "—"), styles: { halign: "center" } },
      otNum(ot),
      textoDescripcion(ot.descripcion || linea0?.descripcion, linea0?.resolucion, linea0?.estadoFinal),
      [textoTareasCol, alertas].filter(Boolean).join("\n"),
      { content: "PLAN", styles: { halign: "center", fontStyle: "bold", textColor: VERDE } },
    ], { fill: ot.critica ? BG_CRITICA : ot.esGuardia ? BG_GUARDIA : BG_PLAN_FILA });
  });

  if (otsPlanBitacora.length > 0 || otsRegistradas.length > 0) {
    filaSeccion(`CMR / CMP REGISTRADOS EN SISTEMA (${otsPlanBitacora.length + otsRegistradas.length} OT${(otsPlanBitacora.length + otsRegistradas.length) !== 1 ? "s" : ""})`, BG_REGISTRO, VERDE_OSC);
  }

  otsPlanBitacora.forEach((ot, idx) => {
    (ot.bitacora ?? []).forEach((b: BitacoraEntry, bi: number) => {
      push([
        { content: `${otsPlanResto.length + idx + 1}.${bi + 1}`, styles: { halign: "center" } },
        `${tipoOtDisplay(ot.tipoOT || "PDM").texto}\n(OPEPLANT)`,
        "OPEPLANT",
        { content: b.hhAtendidas ? String(b.hhAtendidas) : "—", styles: { halign: "center" } },
        otNum(ot),
        textoDescripcion(b.nota || ot.descripcion, b.resolucion, b.estadoFinal),
        { content: [b.supervisor, b.turno].filter(Boolean).join(" · ") || "—", colSpan: 2, styles: { textColor: AMBAR_OSC } },
      ], { fill: BG_GUARDIA });
    });
  });

  otsRegistradas.forEach((ot, idx) => {
    const concluida = ["completada", "concluido", "revisado"].includes(ot.estado);
    const lineas = ot.lineas && ot.lineas.length > 0 ? ot.lineas : null;
    const baseIdx = otsPlanResto.length + otsPlanBitacora.length + idx + 1;
    const bgRow: [number, number, number] = ot.critica ? BG_CRITICA : concluida ? BG_REGISTRO : BLANCO;
    const estadoTxt = concluida ? "EJECUTADA" : "PENDIENTE";
    const estadoColor: [number, number, number] = concluida ? VERDE : AMBAR_OSC;

    if (lineas && lineas.length > 1) {
      const alertas = [ot.critica ? "CRÍTICA" : "", ot.pendiente ? "PASA A SGTE. TURNO" : ""].filter(Boolean).join("  ");
      push([
        { content: String(baseIdx), styles: { halign: "center", fontStyle: "bold" } },
        { content: `OT ${otNum(ot)} · Total: ${ot.hhTotal}HH`, colSpan: 4, styles: { fontStyle: "bold", textColor: AZUL_OSC } },
        { content: [ot.nota || "—", alertas].filter(Boolean).join("  "), colSpan: 2, styles: { fontStyle: ot.nota ? "normal" : "italic", textColor: ot.nota ? NEGRO : GRIS } },
        { content: estadoTxt, styles: { halign: "center", fontStyle: "bold", textColor: estadoColor } },
      ], { fill: BG_MULTILINEA });
      lineas.forEach((l: LineaDisplay, li: number) => {
        push([
          { content: `${baseIdx}.${li + 1}`, styles: { halign: "center", fontSize: 7, textColor: GRIS } },
          tipoOtDisplay(l.tipoOT).texto,
          l.tag,
          { content: l.hh ? String(l.hh) : "—", styles: { halign: "center" } },
          otNum(ot),
          textoDescripcion(l.descripcion, l.resolucion, l.estadoFinal),
          { content: textoTareas(l.tareasEjecutadas, l.descripcionTrabajo), colSpan: 2 },
        ], { fill: bgRow });
      });
      return;
    }

    const linea0 = lineas?.[0];
    const alertas = [ot.critica ? "CRÍTICA" : "", ot.pendiente ? "PASA A SGTE. TURNO" : ""].filter(Boolean).join("  ");
    push([
      { content: String(baseIdx), styles: { halign: "center" } },
      tipoOtDisplay(ot.tipoOT).texto,
      ot.tag,
      { content: String(ot.hhTotal || "—"), styles: { halign: "center" } },
      otNum(ot),
      textoDescripcion(ot.descripcion, linea0?.resolucion, linea0?.estadoFinal),
      [textoTareas(linea0?.tareasEjecutadas, linea0?.descripcionTrabajo), alertas].filter(Boolean).join("\n"),
      { content: estadoTxt, styles: { halign: "center", fontStyle: "bold", textColor: estadoColor } },
    ], { fill: bgRow });
  });

  if (ots.length === 0) {
    push([{ content: "Sin OTs registradas en este turno.", colSpan: 8, styles: { halign: "center", fontStyle: "italic", textColor: GRIS } }]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 10, bottom: 12 },
    head: [["ITEM", "TIPO", "EQUIPO TAG", "HRS", "OT #", "DESCRIPCIÓN DEL TRABAJO", "TAREAS EJECUTADAS", "ESTADO"]],
    body,
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: [0, 0, 0], lineWidth: 0.2, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: NAVY, textColor: BLANCO, fontStyle: "bold", fontSize: 7.5, halign: "center" },
    columnStyles: {
      0: { cellWidth: COL.item }, 1: { cellWidth: COL.tipo }, 2: { cellWidth: COL.tag, fontStyle: "bold" },
      3: { cellWidth: COL.hrs }, 4: { cellWidth: COL.otNum }, 5: { cellWidth: COL.desc },
      6: { cellWidth: COL.tareas }, 7: { cellWidth: COL.estado },
    },
    didParseCell: (data: CellHookData) => {
      if (data.section !== "body") return;
      const meta = filaMeta[data.row.index];
      const rawCell = data.cell.raw;
      const tieneEstiloPropio = typeof rawCell === "object" && rawCell !== null && "styles" in rawCell && rawCell.styles?.fillColor !== undefined;
      if (meta?.fill && !tieneEstiloPropio) data.cell.styles.fillColor = meta.fill;
    },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  // ── NOVEDADES / ALERTAS ───────────────────────────────────────────────────
  y = checkPage(doc, y, 16);
  doc.setFillColor(232, 237, 244);
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, PW - MARGIN * 2, 6, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...NEGRO);
  doc.text("NOVEDADES / ALERTAS PARA EL SIGUIENTE TURNO", MARGIN + 2, y + 4.2);
  y += 6;

  if (reporte.novedades.length === 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      body: [[{ content: "Sin novedades registradas.", styles: { fontStyle: "italic", textColor: GRIS, fontSize: 7.5 } }]],
      theme: "grid",
      styles: { cellPadding: 2 },
    });
  } else {
    const PRIOR_COLOR: Record<string, [number, number, number]> = { URGENTE: ROJO, ATENCION: AMBAR, INFORMACION: AZUL };
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [["NIVEL", "TAG", "DESCRIPCIÓN / NOVEDAD"]],
      body: reporte.novedades.map((n: Novedad) => [
        { content: n.prioridad, styles: { halign: "center", fontStyle: "bold", textColor: PRIOR_COLOR[n.prioridad] ?? NEGRO } },
        n.tag ?? "—",
        n.descripcion,
      ]),
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: [0, 0, 0], lineWidth: 0.2 },
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontStyle: "bold", fontSize: 7.5, halign: "center" },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 35 } },
    });
  }
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  // ── OTs CRÍTICAS / PENDIENTES SIGUIENTE TURNO (dos columnas) ─────────────
  // Cada columna se dibuja con doc.text/doc.line "a mano" (no autoTable, que
  // pagina solo). Un turno con muchas OTs críticas/pendientes puede exceder
  // el alto de una página, así que cada ítem se chequea individualmente y,
  // si no entra, se agrega una página nueva — igual que hace autoTable para
  // la tabla principal — para no perder ítems silenciosamente al final de
  // la página.
  if (criticas.length > 0 || pendientesSig.length > 0) {
    const wCol = (PW - MARGIN * 2 - 4) / 2;
    const xCol2 = MARGIN + wCol + 4;

    type PosPagina = { pagina: number; y: number };

    const dibujarLista = (titulo: string, items: OTDisplay[], x: number, colorTitulo: [number, number, number], inicio: PosPagina): PosPagina => {
      doc.setPage(inicio.pagina);
      let yy = inicio.y;
      doc.setFillColor(232, 237, 244);
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
      doc.rect(x, yy, wCol, 5.5, "FD");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...colorTitulo);
      doc.text(titulo, x + 2, yy + 3.9);
      yy += 6.5;
      doc.setFontSize(7); doc.setTextColor(...NEGRO);
      items.forEach(o => {
        const linea = `${otNum(o)} — ${o.tag} — ${o.descripcion}`;
        const wrapped = doc.splitTextToSize(linea, wCol - 4);
        const alturaItem = wrapped.length * 3.3 + 0.5;
        if (yy + alturaItem > doc.internal.pageSize.getHeight() - 14) {
          doc.addPage();
          yy = 15;
        }
        doc.setFont("helvetica", "normal");
        doc.text(wrapped, x + 2, yy + 2.8);
        doc.setDrawColor(230, 230, 230); doc.setLineWidth(0.15);
        doc.line(x, yy + wrapped.length * 3.3, x + wCol, yy + wrapped.length * 3.3);
        yy += alturaItem;
      });
      return { pagina: doc.getCurrentPageInfo().pageNumber, y: yy };
    };

    y = checkPage(doc, y, 20);
    const inicio: PosPagina = { pagina: doc.getCurrentPageInfo().pageNumber, y };
    const finCrit = criticas.length > 0 ? dibujarLista(`OTs CRÍTICAS (${criticas.length})`, criticas, MARGIN, ROJO, inicio) : inicio;
    const finPend = pendientesSig.length > 0 ? dibujarLista(`PENDIENTES SIGUIENTE TURNO (${pendientesSig.length})`, pendientesSig, xCol2, AMBAR, inicio) : inicio;
    // El pie/footer se dibuja debajo de la columna que haya terminado más
    // abajo, en la página donde efectivamente terminó (puede diferir entre
    // columnas si una se extendió a páginas adicionales).
    const finMasAbajo = finCrit.pagina > finPend.pagina || (finCrit.pagina === finPend.pagina && finCrit.y >= finPend.y) ? finCrit : finPend;
    doc.setPage(finMasAbajo.pagina);
    y = finMasAbajo.y + 3;
  }

  // ── Pie ───────────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "italic"); doc.setFontSize(6.5); doc.setTextColor(...GRIS);
  doc.text("Reporte generado por Sync MSC — Sistema de Gestión de Mantenimiento Planta", PW / 2, Math.min(y, doc.internal.pageSize.getHeight() - 12), { align: "center" });

  piePagina(doc, reporte.tecnicoNombre);

  const fechaArchivo = reporte.fecha.slice(0, 10);
  doc.save(`Reporte_Turno_Tecnico_${reporte.tecnicoNombre.replace(/\s+/g, "_")}_${fechaArchivo}.pdf`);
}
