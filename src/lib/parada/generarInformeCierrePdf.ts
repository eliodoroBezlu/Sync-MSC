import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Informe de cierre de la Parada de Planta (Fase C). Mismo patrón cliente que
// generarReporteDiarioPdf.ts: banner naranja/navy, piePagina, bloburl + window.open.

const NARANJA = [234, 88, 12] as [number, number, number];
const NAVY = [13, 47, 94] as [number, number, number];
const BLANCO = [255, 255, 255] as [number, number, number];
const NEGRO = [17, 24, 39] as [number, number, number];
const GRIS_L = [248, 250, 252] as [number, number, number];
const GRIS_M = [148, 163, 184] as [number, number, number];
const BORDE = [226, 232, 240] as [number, number, number];
const ROJO = [185, 28, 28] as [number, number, number];
const VERDE = [21, 128, 61] as [number, number, number];

type WithY = jsPDF & { lastAutoTable?: { finalY: number } };

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const norm = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) + "T12:00:00" : iso;
  return new Date(norm).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtCorta(iso: string): string {
  const norm = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) + "T12:00:00" : iso;
  return new Date(norm).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" });
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

const ESTADO_TXT: Record<string, string> = {
  no_iniciada: "No iniciada",
  en_ejecucion: "En ejecución",
  terminada: "Terminada",
  con_retraso: "Con retraso",
};

const DISC_TXT: Record<string, string> = {
  ELEC: "Eléctricos",
  INST: "Instrumentistas",
  TESA: "SC Tesa",
  MIXTO: "Mixto",
};

export interface DetalleOtCierre {
  numeroOT: string;
  descripcion: string;
  disciplina: string;
  grupo: string;
  hhEst: number;
  hhReal: number;
  avancePct: number;
  estado: string;
}

export interface DisciplinaCierre {
  disciplina: string;
  avancePct: number;
  otsTotal: number;
  otsTerminadas: number;
  hhEst: number;
  hhReal: number;
}

export interface PuntoSerieCierre {
  fecha: string;
  avancePlanAcum: number;
  avanceRealAcum: number;
  hhReal: number;
}

export interface DatosInformeCierre {
  paradaCodigo: string;
  paradaNombre: string;
  planta: string | null;
  fechaPreparativosInicio: string;
  fechaEjecucionInicio: string;
  fechaEjecucionFin: string;
  fechaCierre: string | null;
  estado: string;
  // Indicadores finales (del tablero).
  avanceGlobalPct: number;
  cumplimientoPct: number;
  otsEjecucion: { total: number; terminadas: number; enEjecucion: number; noIniciadas: number; conRetraso: number };
  otsPreparativos: { total: number; terminadas: number };
  hh: { hhEst: number; hhReal: number; factorProductividad: number };
  porDisciplina: DisciplinaCierre[];
  serieDiaria: PuntoSerieCierre[];
  detalleOts: DetalleOtCierre[];
  otsPendientes: { numeroOT: string; descripcion: string; disciplina: string; avancePct: number; estado: string }[];
  retrasosReportados: { numeroOT: string; motivo: string; accion: string }[];
  pendientesReportados: { tipo: string; detalle: string }[];
  leccionesAprendidas: string;
  observacionesCierre: string;
  generadoPor: string;
}

/** Mini curva de avance acumulado (plan gris vs real naranja) con primitivas de jsPDF. */
function curvaAvance(doc: jsPDF, x: number, y: number, w: number, h: number, serie: PuntoSerieCierre[]) {
  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...GRIS_M);
  for (const p of [0, 50, 100]) {
    const yy = y + h - (p / 100) * h;
    doc.line(x, yy, x + w, yy);
    doc.text(String(p), x - 1.5, yy + 1, { align: "right" });
  }
  const n = serie.length;
  if (n === 0) return;
  const px = (i: number) => x + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const py = (v: number) => y + h - (Math.min(100, Math.max(0, v)) / 100) * h;

  doc.setDrawColor(...GRIS_M);
  doc.setLineWidth(0.4);
  for (let i = 1; i < n; i++) {
    doc.line(px(i - 1), py(serie[i - 1].avancePlanAcum), px(i), py(serie[i].avancePlanAcum));
  }
  doc.setDrawColor(...NARANJA);
  doc.setLineWidth(0.7);
  for (let i = 1; i < n; i++) {
    doc.line(px(i - 1), py(serie[i - 1].avanceRealAcum), px(i), py(serie[i].avanceRealAcum));
  }
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  serie.forEach((p, i) => {
    doc.setFillColor(...NARANJA);
    doc.circle(px(i), py(p.avanceRealAcum), 0.7, "F");
    doc.text(fmtCorta(p.fecha), px(i), y + h + 4, { align: "center" });
  });

  // Leyenda.
  const ly = y + h + 8;
  doc.setDrawColor(...GRIS_M);
  doc.setLineWidth(0.4);
  doc.line(x, ly, x + 6, ly);
  doc.setTextColor(...NEGRO);
  doc.text("Plan", x + 8, ly + 1);
  doc.setDrawColor(...NARANJA);
  doc.setLineWidth(0.7);
  doc.line(x + 22, ly, x + 28, ly);
  doc.text("Real", x + 30, ly + 1);
}

function seccionTitulo(doc: jsPDF, texto: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text(texto, 12, y);
  return y + 2;
}

function asegurarEspacio(doc: jsPDF, y: number, necesita: number): number {
  const PH = doc.internal.pageSize.getHeight();
  if (y + necesita > PH - 16) {
    doc.addPage();
    return 18;
  }
  return y;
}

export function generarInformeCierrePdf(d: DatosInformeCierre): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const M = 12;

  // ── Encabezado ────────────────────────────────────────────────────────────
  doc.setFillColor(...NARANJA);
  doc.rect(0, 0, PW, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BLANCO);
  doc.text("INFORME DE CIERRE DE PARADA", PW / 2, 10, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${d.paradaCodigo} — ${d.paradaNombre}`, PW / 2, 16.5, { align: "center" });

  doc.setTextColor(...NEGRO);
  doc.setFontSize(8.5);
  const meta1 = `Planta: ${d.planta || "—"}   ·   Preparativos: ${fmt(d.fechaPreparativosInicio)}   ·   Ejecución: ${fmt(d.fechaEjecucionInicio)} → ${fmt(d.fechaEjecucionFin)}`;
  const meta2 = `Estado: ${d.estado === "cerrada" ? "Cerrada" : d.estado}   ·   Fecha de cierre: ${fmt(d.fechaCierre)}   ·   Generado por: ${d.generadoPor || "—"}`;
  doc.text(meta1, M, 29);
  doc.text(meta2, M, 33.5);

  // ── Bloque de indicadores finales ────────────────────────────────────────
  const otsE = d.otsEjecucion;
  const kpis: [string, string][] = [
    ["Avance global", `${Math.round(d.avanceGlobalPct)}%`],
    ["Cumpl. programa", `${Math.round(d.cumplimientoPct)}%`],
    ["OTs ejec. terminadas", `${otsE.terminadas} / ${otsE.total}`],
    ["HH estimadas", d.hh.hhEst.toFixed(0)],
    ["HH reales", d.hh.hhReal.toFixed(0)],
    ["Factor productividad", d.hh.factorProductividad ? d.hh.factorProductividad.toFixed(2) : "—"],
  ];
  autoTable(doc, {
    startY: 38,
    margin: { left: M, right: M },
    body: [kpis.map(([k]) => k), kpis.map(([, v]) => v)],
    theme: "grid",
    styles: { fontSize: 8, halign: "center", cellPadding: 2, lineColor: BORDE, lineWidth: 0.2 },
    bodyStyles: { textColor: NEGRO },
    didParseCell: (data) => {
      if (data.row.index === 0) {
        data.cell.styles.fillColor = NAVY;
        data.cell.styles.textColor = BLANCO;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 7;
      } else {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 10;
      }
    },
  });
  let y = ((doc as WithY).lastAutoTable?.finalY ?? 50) + 8;

  // ── Curva de avance 11 → 13 ──────────────────────────────────────────────
  if (d.serieDiaria.length > 0) {
    y = seccionTitulo(doc, "Curva de avance acumulado", y);
    y += 4;
    curvaAvance(doc, M + 8, y, PW - 2 * M - 16, 30, d.serieDiaria);
    y += 30 + 14;
  }

  // ── Cumplimiento por disciplina ─────────────────────────────────────────
  y = asegurarEspacio(doc, y, 34);
  y = seccionTitulo(doc, "Cumplimiento por disciplina", y);
  autoTable(doc, {
    startY: y + 1,
    margin: { left: M, right: M },
    head: [["Disciplina", "OTs term. / total", "% avance", "HH est.", "HH real", "Desvío HH"]],
    body: d.porDisciplina.map((x) => {
      const desv = x.hhReal - x.hhEst;
      return [
        DISC_TXT[x.disciplina] ?? x.disciplina,
        `${x.otsTerminadas} / ${x.otsTotal}`,
        `${Math.round(x.avancePct)}%`,
        x.hhEst.toFixed(0),
        x.hhReal.toFixed(0),
        `${desv > 0 ? "+" : ""}${desv.toFixed(0)}`,
      ];
    }),
    headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
    bodyStyles: { fontSize: 8, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
    alternateRowStyles: { fillColor: GRIS_L },
    columnStyles: {
      0: { cellWidth: 40, fontStyle: "bold" },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "center" },
    },
  });
  y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 8;

  // ── Detalle de HH reales por OT ─────────────────────────────────────────
  y = asegurarEspacio(doc, y, 24);
  y = seccionTitulo(doc, "HH reales por OT (fase ejecución)", y);
  autoTable(doc, {
    startY: y + 1,
    margin: { left: M, right: M },
    head: [["N° OT", "Descripción", "Disc.", "Grupo", "HH est.", "HH real", "Desvío", "% av.", "Estado"]],
    body: d.detalleOts.map((o) => {
      const desv = o.hhReal - o.hhEst;
      return [
        o.numeroOT,
        o.descripcion,
        o.disciplina,
        o.grupo,
        o.hhEst.toFixed(0),
        o.hhReal.toFixed(1),
        `${desv > 0 ? "+" : ""}${desv.toFixed(0)}`,
        `${Math.round(o.avancePct)}%`,
        ESTADO_TXT[o.estado] ?? o.estado,
      ];
    }),
    foot: [[
      "TOTAL",
      "",
      "",
      "",
      d.detalleOts.reduce((s, o) => s + o.hhEst, 0).toFixed(0),
      d.detalleOts.reduce((s, o) => s + o.hhReal, 0).toFixed(1),
      `${d.detalleOts.reduce((s, o) => s + (o.hhReal - o.hhEst), 0) > 0 ? "+" : ""}${d.detalleOts.reduce((s, o) => s + (o.hhReal - o.hhEst), 0).toFixed(0)}`,
      "",
      "",
    ]],
    headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 1.4 },
    footStyles: { fillColor: GRIS_L, textColor: NEGRO, fontSize: 7.5, fontStyle: "bold" },
    bodyStyles: { fontSize: 7, cellPadding: 1.4, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
    alternateRowStyles: { fillColor: GRIS_L },
    columnStyles: {
      0: { cellWidth: 20, fontStyle: "bold" },
      1: { cellWidth: 62 },
      2: { cellWidth: 14, halign: "center" },
      3: { cellWidth: 14, halign: "center" },
      4: { cellWidth: 14, halign: "center" },
      5: { cellWidth: 14, halign: "center" },
      6: { cellWidth: 14, halign: "center" },
      7: { cellWidth: 12, halign: "center" },
      8: { halign: "center" },
    },
  });
  y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 8;

  // ── OTs pendientes al cierre ────────────────────────────────────────────
  if (d.otsPendientes.length > 0) {
    y = asegurarEspacio(doc, y, 24);
    y = seccionTitulo(doc, `OTs pendientes al cierre (${d.otsPendientes.length})`, y);
    autoTable(doc, {
      startY: y + 1,
      margin: { left: M, right: M },
      head: [["N° OT", "Descripción", "Disc.", "% avance", "Estado"]],
      body: d.otsPendientes.map((o) => [
        o.numeroOT,
        o.descripcion,
        o.disciplina,
        `${Math.round(o.avancePct)}%`,
        ESTADO_TXT[o.estado] ?? o.estado,
      ]),
      headStyles: { fillColor: ROJO, textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: "bold" },
        1: { cellWidth: 96 },
        2: { cellWidth: 20, halign: "center" },
        3: { cellWidth: 20, halign: "center" },
        4: { halign: "center" },
      },
    });
    y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 8;
  }

  // ── Retrasos reportados durante la parada ───────────────────────────────
  if (d.retrasosReportados.length > 0) {
    y = asegurarEspacio(doc, y, 24);
    y = seccionTitulo(doc, "Retrasos registrados en los reportes diarios", y);
    autoTable(doc, {
      startY: y + 1,
      margin: { left: M, right: M },
      head: [["N° OT", "Motivo", "Acción / compromiso"]],
      body: d.retrasosReportados.map((r) => [r.numeroOT, r.motivo || "—", r.accion || "—"]),
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
      columnStyles: { 0: { cellWidth: 24, fontStyle: "bold" }, 1: { cellWidth: 76 }, 2: { cellWidth: 78 } },
    });
    y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 8;
  }

  // ── Pendientes / requerimientos registrados ─────────────────────────────
  if (d.pendientesReportados.length > 0) {
    y = asegurarEspacio(doc, y, 24);
    y = seccionTitulo(doc, "Pendientes / requerimientos registrados", y);
    autoTable(doc, {
      startY: y + 1,
      margin: { left: M, right: M },
      head: [["Tipo", "Detalle"]],
      body: d.pendientesReportados.map((p) => [p.tipo, p.detalle]),
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
      columnStyles: { 0: { cellWidth: 30, halign: "center" }, 1: { cellWidth: 148 } },
    });
    y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 8;
  }

  // ── Lecciones aprendidas ───────────────────────────────────────────────
  const lecc = d.leccionesAprendidas?.trim();
  if (lecc) {
    y = asegurarEspacio(doc, y, 24);
    y = seccionTitulo(doc, "Lecciones aprendidas", y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...NEGRO);
    const lines = doc.splitTextToSize(lecc, PW - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 4.6 + 6;
  }

  // ── Observaciones de cierre ───────────────────────────────────────────
  const obs = d.observacionesCierre?.trim();
  if (obs) {
    y = asegurarEspacio(doc, y, 24);
    y = seccionTitulo(doc, "Observaciones de cierre", y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...NEGRO);
    const lines = doc.splitTextToSize(obs, PW - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 4.6 + 6;
  }

  // ── Firma ─────────────────────────────────────────────────────────────
  y = asegurarEspacio(doc, y, 26);
  y += 6;
  doc.setDrawColor(...GRIS_M);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + 70, y);
  doc.line(PW - M - 70, y, PW - M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_M);
  doc.text("Superintendencia de Mantenimiento", M, y + 4);
  doc.text("Planificación", PW - M - 70, y + 4);

  // Marca de "aprobado" si ya está cerrada.
  if (d.estado === "cerrada") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...VERDE);
    doc.text(`PARADA CERRADA · ${fmt(d.fechaCierre)}`, PW / 2, y + 4, { align: "center" });
  }

  piePagina(doc, `Informe de cierre ${d.paradaCodigo}`);
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
