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

// Tamaños de fuente (pt) — compactos para impresión.
const FS_BODY = 6.5;
const FS_BAND = 7.5;
const FS_OT = 8; // número de OT: se mantiene legible

// Geometría de la tabla (mm).
const M = 12;
const PAD = 1.4;
const COL_OT = 22;
const COL_DESC = 116;
const COL_PER = 48;
const CONTENT_TOP = 37; // primera página: bajo el encabezado azul + meta
const CONTENT_TOP_NEXT = 16; // páginas siguientes: sólo el encabezado de columnas
const FOOTER_RESERVA = 16; // espacio reservado para la barra de pie
const KEEP_FILAS = 2; // filas que deben acompañar sí o sí a la banda del grupo

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
    doc.text(`SYNC MSC · ${titulo} · Generado ${new Date().toLocaleDateString("es-BO")}`, M, PH - 3.2);
    doc.text(`Pág. ${i} / ${totalPages}`, PW - M, PH - 3.2, { align: "right" });
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

/** Bloque = banda del grupo + sus filas de OT, con las alturas estimadas (mm). */
interface Bloque {
  band: RowInput;
  filas: CellInput[][];
  alturas: number[];
  bandH: number;
  totalH: number;
}

/**
 * "Grupos y OTs por cuadrilla" — un cuadro por turno con la misma estética del
 * Excel que se publica en la parada: banda verde "GRUPO - n", columna PERSONAL
 * combinada por cuadrilla y filas salmón para las OT críticas / de parada.
 * Encabezado azul igual al del Informe de Cierre de OT.
 *
 * Los grupos se paginan a mano: si la banda del grupo y sus primeras filas no
 * entran en lo que queda de la hoja, el grupo completo pasa a la página
 * siguiente (nunca queda la banda verde sola al pie). Se abre en pestaña nueva
 * para revisar antes de imprimir.
 */
export function generarGruposOtsPdf(d: DatosGruposOtsPdf): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const bottomLimit = PH - FOOTER_RESERVA;
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

  // ── Estimadores de altura (mm) para la paginación manual ──────────────────
  const lineaMM = (fs: number) => fs * 0.3528 * 1.15;
  const filaMM = (lineas: number, fs: number) => lineas * lineaMM(fs) + 2 * PAD + 0.8;

  const lineasTexto = (txt: string, ancho: number, fs: number): number => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fs);
    return Math.max(1, doc.splitTextToSize(txt || "—", ancho - 2 * PAD).length);
  };
  const alturaPersonal = (nombres: string[]): number => {
    if (nombres.length === 0) return filaMM(1, FS_BODY);
    let lineas = 0;
    for (const n of nombres) lineas += lineasTexto(n, COL_PER, FS_BODY);
    return filaMM(lineas, FS_BODY);
  };

  // ── Bloques (banda + filas) por grupo ────────────────────────────────────
  const bandH = filaMM(1, FS_BAND);
  const bloques: Bloque[] = d.grupos.map((g) => {
    const etiqueta = d.disciplinaUnica
      ? `GRUPO - ${g.numero}`
      : `GRUPO - ${g.numero}  ·  ${DISCIPLINA_LABEL[g.disciplina] ?? g.disciplina}`;
    const band: RowInput = [
      {
        content: etiqueta,
        colSpan: 3,
        styles: { fillColor: VERDE, textColor: NEGRO, fontStyle: "bold", halign: "center", fontSize: FS_BAND },
      },
    ];

    const otsSrc =
      g.ots.length > 0 ? g.ots : [{ numeroOT: "—", descripcion: "Sin OT vinculadas", critica: false }];
    const personalTxt = g.personal.length > 0 ? g.personal.join("\n") : "—";
    const personalH = alturaPersonal(g.personal);

    const filas: CellInput[][] = [];
    const alturas: number[] = [];
    otsSrc.forEach((ot, i) => {
      const critEstilo = ot.critica ? { fillColor: SALMON, fontStyle: "bold" as const } : {};
      const fila: CellInput[] = [
        { content: ot.numeroOT, styles: { fontStyle: "bold", fontSize: FS_OT, halign: "center", ...critEstilo } },
        { content: ot.descripcion, styles: { ...critEstilo } },
      ];
      if (i === 0) {
        fila.push({
          content: personalTxt,
          rowSpan: otsSrc.length,
          styles: { valign: "middle", fontSize: FS_BODY, textColor: NAVY },
        });
      }
      filas.push(fila);
      alturas.push(filaMM(lineasTexto(ot.descripcion, COL_DESC, FS_BODY), FS_BODY));
    });

    // La columna PERSONAL (rowSpan) puede ser más alta que la suma de las filas:
    // el grupo ocupa como mínimo esa altura.
    const sumaFilas = alturas.reduce((a, b) => a + b, 0);
    if (personalH > sumaFilas && alturas.length > 0) alturas[0] += personalH - sumaFilas;

    const totalH = bandH + alturas.reduce((a, b) => a + b, 0);
    return { band, filas, alturas, bandH, totalH };
  });

  // ── Reparto de bloques en páginas (banda nunca huérfana) ─────────────────
  const paginas: RowInput[][] = [[]];
  let y = CONTENT_TOP;
  for (const b of bloques) {
    const minKeep = b.bandH + b.alturas.slice(0, KEEP_FILAS).reduce((a, c) => a + c, 0);
    const restante = bottomLimit - y;
    const primeroDePagina = paginas[paginas.length - 1].length === 0;
    if (!primeroDePagina && restante < Math.min(b.totalH, minKeep)) {
      paginas.push([]);
      y = CONTENT_TOP_NEXT;
    }
    paginas[paginas.length - 1].push(b.band, ...b.filas);
    y += b.totalH;
  }

  // ── Render: un autoTable por página, encabezado de columnas en cada una ──
  paginas.forEach((body, idx) => {
    if (idx > 0) doc.addPage();
    autoTable(doc, {
      startY: idx === 0 ? CONTENT_TOP : CONTENT_TOP_NEXT,
      margin: { left: M, right: M, top: CONTENT_TOP_NEXT, bottom: FOOTER_RESERVA },
      head: [["No. OT", "DESCRIPCIÓN DE ACTIVIDAD", `PERSONAL (${total})`]],
      showHead: "everyPage",
      body,
      rowPageBreak: "avoid",
      headStyles: {
        fillColor: NAVY,
        textColor: BLANCO,
        fontSize: 7,
        fontStyle: "bold",
        cellPadding: 1.6,
        halign: "center",
      },
      bodyStyles: {
        fontSize: FS_BODY,
        cellPadding: PAD,
        textColor: NEGRO,
        lineColor: BORDE,
        lineWidth: 0.2,
        valign: "middle",
      },
      columnStyles: {
        0: { cellWidth: COL_OT, halign: "center" },
        1: { cellWidth: COL_DESC },
        2: { cellWidth: COL_PER, halign: "left" },
      },
    });
  });

  piePagina(doc, `Grupos y OTs · ${d.paradaCodigo} · Turno ${turnoTxt}`);
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
