import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Plan, OtBorrador } from "@/app/planificacion/[id]/types";

const NARANJA = [234, 88, 12] as [number, number, number];
const NAVY    = [13, 47, 94]  as [number, number, number];
const BLANCO  = [255, 255, 255] as [number, number, number];
const NEGRO   = [17, 24, 39]  as [number, number, number];
const GRIS_L  = [248, 250, 252] as [number, number, number];
const BORDE   = [226, 232, 240] as [number, number, number];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) + "T12:00:00" : iso;
  return new Date(normalized).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function rangoSemana(semana: number, anio: number): string {
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return `${lunes.getDate()} ${MESES_ES[lunes.getMonth()]} - ${domingo.getDate()} ${MESES_ES[domingo.getMonth()]} ${anio}`;
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

/**
 * Resumen de OTs de la semana (tipo "Página 4" del Excel de referencia):
 * un listado plano de todas las OTs seleccionadas del plan, con banner
 * naranja "SEMANA n/aa - ÁREA". Se abre en una pestaña nueva (preview del
 * visor nativo del navegador) en lugar de descargarse directo, para que el
 * usuario pueda revisar antes de guardar.
 */
export async function generarResumenOtsPdf(plan: Plan): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();

  const contratistas = new Set(plan.roster.filter(r => r.esContratista).map(r => r.nombre));
  const esContratista = (ot: OtBorrador) => ot.personalAsignado.some(n => contratistas.has(n));

  const ots = plan.ots
    .filter(o => o.seleccionada || o.esGuardia)
    .slice()
    .sort((a, b) => a.numeroOT.localeCompare(b.numeroOT, undefined, { numeric: true }));

  // ── Banner naranja ──────────────────────────────────────────────────────
  doc.setFillColor(...NARANJA);
  doc.rect(0, 0, PW, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...BLANCO);
  doc.text(`SEMANA ${plan.semana}/${String(plan.anio).slice(-2)} — ${plan.areaCodigo} / ${plan.disciplina}`, PW / 2, 12, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(rangoSemana(plan.semana, plan.anio), PW / 2, 17.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...NEGRO);
  doc.text(`Resumen de Órdenes de Trabajo · ${ots.length} OTs · ${ots.reduce((s, o) => s + o.hhTotal, 0).toFixed(0)} HH totales`, 10, 27);

  // ── Escalado dinámico para garantizar que todo entre en una sola hoja ────
  const PH = doc.internal.pageSize.getHeight();
  const ALTO_DISPONIBLE = PH - 31 - 9 - 4; // banner+subtítulo arriba, pie abajo, margen
  const ALTO_HEAD = 7.5;
  const filas = Math.max(ots.length, 1);
  const altoFila = Math.max((ALTO_DISPONIBLE - ALTO_HEAD) / filas, 2.2);
  const fontSize = Math.min(7, Math.max(3.4, altoFila / 1.7));
  const cellPadding = Math.min(1.8, Math.max(0.3, fontSize * 0.22));
  // Siempre en una sola línea: el texto largo (p.ej. Tipo Trabajo) se trunca
  // en vez de agrandar la fila y desconfigurar el alto uniforme de la tabla.
  const overflow = "ellipsize" as const;

  autoTable(doc, {
    startY: 31,
    margin: { left: 10, right: 10 },
    head: [[
      "Cont", "N° OT", "Tipo OT", "Tipo Trab.", "Prioridad", "Job Description",
      "Equipo", "Descripción de Equipo", "N° Pers.", "Hr Trab.", "HH Est.",
      "F. Inicio", "F. Final", "Días",
    ]],
    body: ots.map(ot => [
      esContratista(ot) ? "SI" : "",
      ot.numeroOT,
      ot.tipoOT,
      ot.tipoTrabajo,
      ot.prioridad ?? "—",
      ot.descripcion,
      ot.tag,
      ot.descripcionEquipo,
      String(ot.personas),
      String(ot.hrsTrabajo),
      ot.hhTotal.toFixed(0),
      fmt(ot.fechaInicioOt),
      fmt(ot.fechaFinOt),
      String(ot.dias.length),
    ]),
    headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: Math.min(fontSize + 0.5, 7), fontStyle: "bold", cellPadding, halign: "center" },
    bodyStyles: { fontSize, cellPadding, textColor: NEGRO, overflow, lineColor: BORDE, lineWidth: 0.2 },
    alternateRowStyles: { fillColor: GRIS_L },
    columnStyles: {
      0: { cellWidth: 10, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 20, fontStyle: "bold" },
      2: { cellWidth: 14, halign: "center" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 14, halign: "center" },
      5: { cellWidth: 55 },
      6: { cellWidth: 20 },
      7: { cellWidth: 45 },
      8: { cellWidth: 12, halign: "center" },
      9: { cellWidth: 12, halign: "center" },
      10: { cellWidth: 14, halign: "center" },
      11: { cellWidth: 16, halign: "center" },
      12: { cellWidth: 16, halign: "center" },
      13: { cellWidth: 12, halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0 && data.cell.raw === "SI") {
        data.cell.styles.textColor = NARANJA;
      }
    },
  });

  piePagina(doc, `Resumen OTs Semana ${plan.semana}/${plan.anio}`);

  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
