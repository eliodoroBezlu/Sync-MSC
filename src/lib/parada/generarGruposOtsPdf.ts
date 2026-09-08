import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellInput, RowInput } from "jspdf-autotable";

const NAVY = [13, 47, 94] as [number, number, number];
const AZUL = [37, 99, 235] as [number, number, number];
const HDR_BG = [235, 242, 255] as [number, number, number];
const HDR_TOP = [59, 100, 165] as [number, number, number];
const BLANCO = [255, 255, 255] as [number, number, number];
const NEGRO = [17, 24, 39] as [number, number, number];
const BORDE = [203, 213, 225] as [number, number, number];
const VERDE = [130, 190, 108] as [number, number, number]; // banda "GRUPO - n"
const SALMON = [250, 219, 216] as [number, number, number]; // OT crítica / de parada

const DISCIPLINA_LABEL: Record<string, string> = {
  ELEC: "Eléctricos",
  INST: "Instrumentistas",
  TESA: "SC Tesa",
  MIXTO: "Mixto",
};

export interface GrupoImpresion {
  disciplina: string;
  numero: number;
  personal: string[];
  ots: { numeroOT: string; descripcion: string; critica: boolean }[];
}

export interface DatosGruposOtsPdf {
  paradaCodigo: string;
  paradaNombre: string;
  turno: "Dia" | "Noche";
  /** Etiqueta de área para el encabezado ("Eléctricos" / "Todas las áreas"). */
  areaTxt: string;
  /** true cuando el PDF muestra una sola disciplina (no repetir la etiqueta en cada banda). */
  disciplinaUnica: boolean;
  grupos: GrupoImpresion[];
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
    doc.setFontSize(6);
    doc.setTextColor(...BLANCO);
    doc.text(`SYNC MSC · ${titulo} · Generado ${new Date().toLocaleDateString("es-BO")}`, 12, PH - 3.2);
    doc.text(`Pág. ${i} / ${totalPages}`, PW - 12, PH - 3.2, { align: "right" });
  }
}

/** Nº de personas distintas (sin acentos, mayúsculas) entre todos los grupos. */
function totalPersonal(grupos: GrupoImpresion[]): number {
  const vistos = new Set<string>();
  for (const g of grupos) {
    for (const nombre of g.personal) {
      const k = nombre.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
      if (k) vistos.add(k);
    }
  }
  return vistos.size;
}

/**
 * "Grupos y OTs por cuadrilla" — un cuadro por turno con la misma estética del
 * Excel que se publica en la parada: banda verde "GRUPO - n", columna PERSONAL
 * combinada por cuadrilla y filas salmón para las OT críticas / de parada.
 * Encabezado azul igual al del Informe de Cierre de OT. Se abre en pestaña
 * nueva para revisar antes de imprimir.
 */
export function generarGruposOtsPdf(d: DatosGruposOtsPdf): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const M = 12;
  const turnoTxt = d.turno === "Dia" ? "Día" : "Noche";

  // ── Encabezado azul (igual al Informe de Cierre de OT) ─────────────────────
  doc.setFillColor(...HDR_TOP);
  doc.rect(0, 0, PW, 5, "F");
  doc.setFillColor(...HDR_BG);
  doc.rect(0, 5, PW, 22, "F");
  doc.setFillColor(...AZUL);
  doc.rect(0, 27, PW, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text("SYNC MSC", M, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...HDR_TOP);
  doc.text("Sistema de Gestión de Mantenimiento", M, 18);
  doc.text(`Grupos y OTs por cuadrilla · Turno ${turnoTxt} · ${d.areaTxt}`, M, 22.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(`PARADA ${d.paradaCodigo}`, PW - M, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...HDR_TOP);
  doc.text(doc.splitTextToSize(d.paradaNombre, 78), PW - M, 18, { align: "right" });

  const total = totalPersonal(d.grupos);
  const nOts = d.grupos.reduce((s, g) => s + g.ots.length, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...NEGRO);
  doc.text(
    `${d.grupos.length} grupos · ${nOts} OTs · ${total} personas · ${new Date().toLocaleDateString("es-BO")}`,
    M,
    33,
  );

  // ── Cuerpo: banda de grupo + filas de OT con PERSONAL combinado ───────────
  const body: RowInput[] = [];
  for (const g of d.grupos) {
    const etiqueta = d.disciplinaUnica
      ? `GRUPO - ${g.numero}`
      : `GRUPO - ${g.numero}  ·  ${DISCIPLINA_LABEL[g.disciplina] ?? g.disciplina}`;
    body.push([
      { content: etiqueta, colSpan: 3, styles: { fillColor: VERDE, textColor: NEGRO, fontStyle: "bold", halign: "center", fontSize: 7.5 } },
    ]);

    const filas = g.ots.length > 0 ? g.ots : [{ numeroOT: "—", descripcion: "Sin OT vinculadas", critica: false }];
    const personalTxt = g.personal.length > 0 ? g.personal.join("\n") : "—";
    filas.forEach((ot, i) => {
      const critEstilo = ot.critica ? { fillColor: SALMON, fontStyle: "bold" as const } : {};
      const fila: CellInput[] = [
        { content: ot.numeroOT, styles: { fontStyle: "bold", fontSize: 8, halign: "center", ...critEstilo } },
        { content: ot.descripcion, styles: { ...critEstilo } },
      ];
      if (i === 0) {
        fila.push({
          content: personalTxt,
          rowSpan: filas.length,
          styles: { valign: "middle", fontSize: 6.5, textColor: NAVY },
        });
      }
      body.push(fila);
    });
  }

  autoTable(doc, {
    startY: 37,
    margin: { left: M, right: M },
    head: [["No. OT", "DESCRIPCIÓN DE ACTIVIDAD", `PERSONAL (${total})`]],
    body,
    headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 1.6, halign: "center" },
    bodyStyles: { fontSize: 6.5, cellPadding: 1.4, textColor: NEGRO, lineColor: BORDE, lineWidth: 0.2, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 22, halign: "center" },
      1: { cellWidth: 116 },
      2: { cellWidth: 48, halign: "left" },
    },
  });

  piePagina(doc, `Grupos y OTs · ${d.paradaCodigo} · Turno ${turnoTxt}`);
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
