import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const NARANJA = [234, 88, 12] as [number, number, number];
const NAVY = [13, 47, 94] as [number, number, number];
const BLANCO = [255, 255, 255] as [number, number, number];
const NEGRO = [17, 24, 39] as [number, number, number];
const GRIS_L = [248, 250, 252] as [number, number, number];
const BORDE = [226, 232, 240] as [number, number, number];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const norm = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) + "T12:00:00" : iso;
  return new Date(norm).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
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

export interface DatosReportePdf {
  paradaCodigo: string;
  paradaNombre: string;
  fecha: string;
  turno: "Dia" | "Noche";
  reunion: "08:00" | "17:00";
  supervisorNombre: string;
  resumen: string;
  avanceGlobalPct: number;
  hhPropias: number;
  hhApoyo: number;
  otsTerminadas: string[];
  otsConRetraso: { numeroOT: string; motivo: string; accion: string }[];
  pendientes: { tipo: string; detalle: string }[];
  observaciones: string | null;
  // Indicadores opcionales del tablero al día del reporte.
  cumplimientoHoyPct?: number;
  diaEtiqueta?: string;
  hhEst?: number;
  // Avance por OT en el turno (para la tabla de detalle).
  detalleOts?: {
    numeroOT: string;
    descripcion: string;
    disciplina: string;
    avancePct: number;
    hhTurno: number;
    estado: string;
  }[];
}

const ESTADO_TXT: Record<string, string> = {
  no_iniciada: "No iniciada",
  en_ejecucion: "En ejecución",
  terminada: "Terminada",
  con_retraso: "Con retraso",
};

export function generarReporteDiarioPdf(d: DatosReportePdf): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const M = 12;

  // ── Encabezado ────────────────────────────────────────────────────────────
  doc.setFillColor(...NARANJA);
  doc.rect(0, 0, PW, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BLANCO);
  doc.text(`REPORTE DIARIO DEL SUPERVISOR`, PW / 2, 10, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${d.paradaCodigo} — ${d.paradaNombre}`,
    PW / 2,
    16.5,
    { align: "center" },
  );

  doc.setTextColor(...NEGRO);
  doc.setFontSize(9);
  const turnoTxt = d.turno === "Dia" ? "Día" : "Noche";
  const lineaMeta = `Fecha: ${fmt(d.fecha)}   ·   Turno: ${turnoTxt}   ·   Reunión: ${d.reunion}   ·   Supervisor: ${d.supervisorNombre || "—"}`;
  doc.text(lineaMeta, M, 30);
  if (d.diaEtiqueta) {
    doc.setTextColor(120, 120, 120);
    doc.text(d.diaEtiqueta, PW - M, 30, { align: "right" });
    doc.setTextColor(...NEGRO);
  }

  // ── Bloque de indicadores ─────────────────────────────────────────────────
  const kpis: [string, string][] = [
    ["Avance global", `${Math.round(d.avanceGlobalPct)}%`],
    ["Cumpl. programa", d.cumplimientoHoyPct != null ? `${Math.round(d.cumplimientoHoyPct)}%` : "—"],
    ["HH propias (turno)", d.hhPropias.toFixed(1)],
    ["HH apoyo (turno)", d.hhApoyo.toFixed(1)],
    ["HH total turno", (d.hhPropias + d.hhApoyo).toFixed(1)],
    ["HH estimadas plan", d.hhEst != null ? d.hhEst.toFixed(0) : "—"],
  ];
  autoTable(doc, {
    startY: 34,
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

  type WithY = jsPDF & { lastAutoTable?: { finalY: number } };
  let y = ((doc as WithY).lastAutoTable?.finalY ?? 50) + 7;

  // ── Resumen del turno ─────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text("Resumen del turno", M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...NEGRO);
  const resumenLines = doc.splitTextToSize(d.resumen?.trim() || "—", PW - 2 * M);
  doc.text(resumenLines, M, y);
  y += resumenLines.length * 4.6 + 5;

  // ── Detalle de OTs del turno ──────────────────────────────────────────────
  if (d.detalleOts && d.detalleOts.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text("Avance de OTs en el turno", M, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["N° OT", "Descripción", "Disc.", "% avance", "HH turno", "Estado"]],
      body: d.detalleOts.map((o) => [
        o.numeroOT,
        o.descripcion,
        o.disciplina,
        `${Math.round(o.avancePct)}%`,
        o.hhTurno.toFixed(1),
        ESTADO_TXT[o.estado] ?? o.estado,
      ]),
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
      alternateRowStyles: { fillColor: GRIS_L },
      columnStyles: {
        0: { cellWidth: 24, fontStyle: "bold" },
        1: { cellWidth: 78 },
        2: { cellWidth: 16, halign: "center" },
        3: { cellWidth: 18, halign: "center" },
        4: { cellWidth: 18, halign: "center" },
        5: { cellWidth: 24, halign: "center" },
      },
    });
    y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 7;
  }

  // ── OTs terminadas ───────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text(`OTs terminadas (${d.otsTerminadas.length})`, M, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...NEGRO);
  doc.text(d.otsTerminadas.length ? d.otsTerminadas.join(", ") : "—", M, y, { maxWidth: PW - 2 * M });
  y += 8;

  // ── OTs con retraso + acción ─────────────────────────────────────────────
  if (d.otsConRetraso.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text("OTs con retraso y acción correctiva", M, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["N° OT", "Motivo del retraso", "Acción / compromiso"]],
      body: d.otsConRetraso.map((o) => [o.numeroOT, o.motivo || "—", o.accion || "—"]),
      headStyles: { fillColor: [185, 28, 28], textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
      columnStyles: { 0: { cellWidth: 26, fontStyle: "bold" }, 1: { cellWidth: 78 }, 2: { cellWidth: 74 } },
    });
    y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 7;
  }

  // ── Pendientes ──────────────────────────────────────────────────────────
  if (d.pendientes.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text("Pendientes / requerimientos", M, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["Tipo", "Detalle"]],
      body: d.pendientes.map((p) => [p.tipo, p.detalle]),
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7.5, fontStyle: "bold", cellPadding: 1.6 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.6, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2 },
      columnStyles: { 0: { cellWidth: 30, halign: "center" }, 1: { cellWidth: 148 } },
    });
    y = ((doc as WithY).lastAutoTable?.finalY ?? y) + 7;
  }

  // ── Observaciones ───────────────────────────────────────────────────────
  if (d.observaciones && d.observaciones.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text("Observaciones", M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...NEGRO);
    const obs = doc.splitTextToSize(d.observaciones.trim(), PW - 2 * M);
    doc.text(obs, M, y);
  }

  piePagina(doc, `Reporte ${turnoTxt} ${fmt(d.fecha)} · ${d.reunion}`);
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
