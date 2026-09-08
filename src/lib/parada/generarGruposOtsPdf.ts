import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData, CellInput, RowInput, UserOptions } from "jspdf-autotable";

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
const FS_TURNO = 8.5; // separador de turno
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
const KEEP_FILAS = 2; // filas que deben acompañar sí o sí a la banda

export interface GrupoImpresion {
  disciplina: string;
  numero: number;
  personal: string[];
  ots: { numeroOT: string; descripcion: string; critica: boolean }[];
}

export interface SeccionTurno {
  turno: "Dia" | "Noche";
  grupos: GrupoImpresion[];
}

export interface DatosGruposOtsPdf {
  paradaCodigo: string;
  paradaNombre: string;
  /** Etiqueta de área para el encabezado ("Eléctricos" / "Todas las áreas"). */
  areaTxt: string;
  /** true cuando el PDF muestra una sola disciplina (no repetir la etiqueta en cada banda). */
  disciplinaUnica: boolean;
  /** Un bloque por turno; se imprimen a continuación en un solo documento. */
  secciones: SeccionTurno[];
}

const turnoLargo = (t: "Dia" | "Noche"): string => (t === "Dia" ? "Día" : "Noche");

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

/** Nº de personas distintas (sin acentos, mayúsculas) entre los grupos dados. */
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

/** Fila lógica del cuerpo: separador de turno, banda de grupo, OT o relleno invisible. */
type Fila =
  | { tipo: "turno"; row: RowInput }
  | { tipo: "banda"; row: RowInput; nFilas: number }
  | { tipo: "ot"; row: CellInput[] }
  | { tipo: "relleno"; alto: number };

/**
 * "Grupos y OTs por cuadrilla" — un solo documento continuo con AMBOS turnos
 * (Día y Noche), con la estética del Excel que se publica en la parada: separador
 * azul por turno, banda verde "GRUPO - n", columna PERSONAL combinada por
 * cuadrilla y filas salmón para las OT críticas / de parada. Encabezado azul
 * igual al del Informe de Cierre de OT.
 *
 * Paginación: un único `autoTable` continuo (autotable maneja TODOS los saltos de
 * página). Para que un separador de turno o una banda "GRUPO - n" no quede sola
 * al pie, se mide el layout en una pasada previa y se inserta un relleno
 * invisible que empuja el bloque completo a la página siguiente. Sin páginas en
 * blanco. Se abre en pestaña nueva para revisar antes de imprimir.
 */
export function generarGruposOtsPdf(d: DatosGruposOtsPdf): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const pageBottom = PH - FOOTER_RESERVA;

  const seccionesUtiles = d.secciones.filter((s) => s.grupos.length > 0);
  const turnosTxt = seccionesUtiles.map((s) => turnoLargo(s.turno)).join(" y ");
  const todosGrupos = seccionesUtiles.flatMap((s) => s.grupos);
  const total = totalPersonal(todosGrupos);
  const nGrupos = todosGrupos.length;
  const nOts = todosGrupos.reduce((s, g) => s + g.ots.length, 0);

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
  doc.text(`Grupos y OTs por cuadrilla · Turnos ${turnosTxt || "—"} · ${d.areaTxt}`, M, 22.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(`PARADA ${d.paradaCodigo}`, PW - M, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...HDR_TOP);
  doc.text(doc.splitTextToSize(d.paradaNombre, 78), PW - M, 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...NEGRO);
  doc.text(
    `${nGrupos} grupos · ${nOts} OTs · ${total} personas · ${new Date().toLocaleDateString("es-BO")}`,
    M,
    33,
  );

  // ── Filas lógicas del cuerpo (ambos turnos) ──────────────────────────────
  const filasDoc: Fila[] = [];
  for (const sec of seccionesUtiles) {
    const nPer = totalPersonal(sec.grupos);
    filasDoc.push({
      tipo: "turno",
      row: [
        {
          content: `TURNO ${turnoLargo(sec.turno).toUpperCase()}  ·  ${nPer} ${nPer === 1 ? "persona" : "personas"}`,
          colSpan: 3,
          styles: {
            fillColor: NAVY,
            textColor: BLANCO,
            fontStyle: "bold",
            halign: "center",
            fontSize: FS_TURNO,
            cellPadding: 1.8,
          },
        },
      ],
    });

    for (const g of sec.grupos) {
      const etiqueta = d.disciplinaUnica
        ? `GRUPO - ${g.numero}`
        : `GRUPO - ${g.numero}  ·  ${DISCIPLINA_LABEL[g.disciplina] ?? g.disciplina}`;
      const otsSrc =
        g.ots.length > 0
          ? g.ots
          : [{ numeroOT: "—", descripcion: "Sin OT vinculadas", critica: false }];

      filasDoc.push({
        tipo: "banda",
        nFilas: otsSrc.length,
        row: [
          {
            content: etiqueta,
            colSpan: 3,
            styles: {
              fillColor: VERDE,
              textColor: NEGRO,
              fontStyle: "bold",
              halign: "center",
              fontSize: FS_BAND,
            },
          },
        ],
      });

      const personalTxt = g.personal.length > 0 ? g.personal.join("\n") : "—";
      otsSrc.forEach((ot, i) => {
        const critEstilo = ot.critica ? { fillColor: SALMON, fontStyle: "bold" as const } : {};
        const fila: CellInput[] = [
          {
            content: ot.numeroOT,
            styles: { fontStyle: "bold", fontSize: FS_OT, halign: "center", ...critEstilo },
          },
          { content: ot.descripcion, styles: { ...critEstilo } },
        ];
        if (i === 0) {
          fila.push({
            content: personalTxt,
            rowSpan: otsSrc.length,
            styles: { valign: "middle", fontSize: FS_BODY, textColor: NAVY },
          });
        }
        filasDoc.push({ tipo: "ot", row: fila });
      });
    }
  }

  // ── Opciones comunes del autoTable ──────────────────────────────────────
  const rellenoRow = (alto: number): RowInput => [
    {
      content: "",
      colSpan: 3,
      styles: {
        minCellHeight: alto,
        fillColor: BLANCO,
        textColor: BLANCO,
        lineWidth: 0,
        cellPadding: 0,
        fontSize: 1,
      },
    },
  ];
  const aBody = (fs: Fila[]): RowInput[] =>
    fs.map((f) => (f.tipo === "relleno" ? rellenoRow(f.alto) : f.row));

  const opciones = (body: RowInput[]): UserOptions => ({
    startY: CONTENT_TOP,
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

  // ── Pasada de medición: y / alto / página de cada fila del cuerpo ────────
  const medir = (fs: Fila[]): ({ y: number; h: number; pag: number } | undefined)[] => {
    const tmp = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const reg: ({ y: number; h: number; pag: number } | undefined)[] = [];
    autoTable(tmp, {
      ...opciones(aBody(fs)),
      willDrawCell: (data: CellHookData) => {
        if (data.section !== "body" || data.column.index !== 0 || !data.cursor) return;
        reg[data.row.index] = {
          y: data.cursor.y,
          h: data.row.height,
          pag: tmp.getNumberOfPages(),
        };
      },
    });
    return reg;
  };

  // ── Empujar a la página siguiente los bloques que quedarían huérfanos ───
  const capacidadPagina = pageBottom - CONTENT_TOP_NEXT;
  const filasFinal: Fila[] = [...filasDoc];
  let guarda = filasDoc.filter((f) => f.tipo === "turno" || f.tipo === "banda").length + 3;

  while (guarda-- > 0) {
    const reg = medir(filasFinal);
    const topPag = new Map<number, number>();
    reg.forEach((r) => {
      if (!r) return;
      const t = topPag.get(r.pag);
      if (t === undefined || r.y < t) topPag.set(r.pag, r.y);
    });

    let insertado = false;
    for (let k = 0; k < filasFinal.length; k++) {
      const f = filasFinal[k];
      if (f.tipo !== "turno" && f.tipo !== "banda") continue;
      const r = reg[k];
      if (!r) continue;

      const top = topPag.get(r.pag) ?? r.y;
      if (r.y <= top + 1.5) continue; // ya arranca al inicio de una página

      // Altura que debe permanecer junto a este bloque.
      let necesita = r.h;
      if (f.tipo === "banda") {
        let completo = r.h;
        for (let j = 1; j <= f.nFilas; j++) completo += reg[k + j]?.h ?? 0;
        necesita =
          completo <= capacidadPagina
            ? completo
            : r.h + [...Array(KEEP_FILAS)].reduce((a, _, j) => a + (reg[k + 1 + j]?.h ?? 0), 0);
      } else {
        // Separador de turno: que baje con su primera banda y su primera OT.
        for (let j = 1; j <= KEEP_FILAS; j++) necesita += reg[k + j]?.h ?? 0;
      }

      if (r.y + necesita > pageBottom + 0.5) {
        filasFinal.splice(k, 0, { tipo: "relleno", alto: Math.max(2, pageBottom - r.y - 0.5) });
        insertado = true;
        break;
      }
    }
    if (!insertado) break;
  }

  // ── Render final: un único autoTable continuo ──────────────────────────
  autoTable(doc, opciones(aBody(filasFinal)));

  piePagina(doc, `Grupos y OTs · ${d.paradaCodigo} · Turnos ${turnosTxt || "—"}`);
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
