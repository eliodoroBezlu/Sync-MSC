import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface AdjuntoItem {
  tipo: "foto" | "documento";
  nombre: string;
  dataUrl: string;
  comentario: string;
  comentariosExtra: string[];
}

interface LineaOT {
  tag: string;
  descripcionEquipo: string;
  tipoOT: string;
  sintoma?: string;
  causaProbable?: string;
  resolucionAplicada?: string;
  tiempoEstimadoHrs?: number;
  tiempoRealHrs?: number;
  descripcionTrabajo?: string;
  tareasEjecutadas?: string[];
  observaciones?: string;
  adjuntos?: AdjuntoItem[];
}

interface DatosSupervision {
  requierePlanificacion?: boolean;
  comentariosSupervisor?: string;
  revisadoPor?: string;
  revisadoEn?: string;
  codigoModoFallaISO?: string;
  clasificacionRCM?: string;
}

interface TecnicoRef { nombreCompleto: string }

interface CambioHistorial {
  fechaHora: string;
  nombreUsuario: string;
  cambio: string;
}

interface RegistroDiario {
  fecha: string;
  tecnico: string;
  hhTrabajadas: number;
  tareasEjecutadas?: string[];
  observaciones?: string;
  adjuntos?: AdjuntoItem[];
}

interface OTData {
  numeroOT?: string;
  otJdeNumero?: string;
  fecha: string;
  turno: string;
  areaCodigo: string;
  estado: string;
  tecnicos: TecnicoRef[];
  lineas: LineaOT[];
  registrosDiarios?: RegistroDiario[];
  datosSupervision?: DatosSupervision;
  historialCambios?: CambioHistorial[];
  hhEstimadasPlan?: number; // HH del plan semanal (overrides suma de lineas para OPEPLANT)
}

// ── Paleta ────────────────────────────────────────────────────────────────────
const NAVY    = [13, 47, 94]     as [number, number, number];
const AZUL    = [37, 99, 235]    as [number, number, number];
const HDR_BG  = [235, 242, 255]  as [number, number, number];
const HDR_TOP = [59, 100, 165]   as [number, number, number];
const GRIS    = [107, 114, 128]  as [number, number, number];
const GRIS_L  = [241, 245, 249]  as [number, number, number];
const BLANCO  = [255, 255, 255]  as [number, number, number];
const NEGRO   = [17, 24, 39]     as [number, number, number];
const VERDE   = [22, 163, 74]    as [number, number, number];
const ROJO    = [220, 38, 38]    as [number, number, number];
const BORDE   = [203, 213, 225]  as [number, number, number]; // marco foto

// ── Labels ────────────────────────────────────────────────────────────────────
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  pendiente_revision: "Pendiente revisión",
  solicitar_correccion: "En corrección",
  revisado: "Revisado",
  concluido: "Concluido",
};

const ESTADO_COLOR: Record<string, [number, number, number]> = {
  concluido:            VERDE,
  revisado:             AZUL,
  pendiente_revision:   [217, 119, 6],
  solicitar_correccion: ROJO,
  borrador:             GRIS,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(d?: string | Date) {
  if (!d) return "—";
  // Tomar solo el prefijo YYYY-MM-DD (venga como fecha sola o como timestamp ISO
  // completo, p.ej. tras un viaje por Prisma) y anclarlo a mediodía local, para que
  // la medianoche UTC no caiga en el día anterior en zonas horarias negativas
  // (Bolivia = UTC-4).
  const match = typeof d === "string" ? d.match(/^(\d{4}-\d{2}-\d{2})/) : null;
  const normalized = match ? match[1] + "T12:00:00" : d;
  return new Date(normalized).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtHrs(n?: number) {
  if (n == null || n === 0) return "—";
  return `${n} h`;
}

// Obtiene las dimensiones reales de una imagen desde su dataUrl
function getImgSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 4, h: 3 }); // fallback 4:3
    img.src = dataUrl;
  });
}

function seccion(doc: jsPDF, texto: string, y: number, PW: number): void {
  doc.setFillColor(...NAVY);
  doc.rect(15, y, 2.5, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text(texto.toUpperCase(), 20, y + 7.5);
  const textW = doc.getTextWidth(texto.toUpperCase());
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(21 + textW, y + 7, PW - 15, y + 7);
}

function estadoBadge(doc: jsPDF, estado: string, x: number, y: number) {
  const label = ESTADO_LABEL[estado] ?? estado;
  const color = ESTADO_COLOR[estado] ?? GRIS;
  const w = doc.getTextWidth(label) + 8;
  doc.setFillColor(...color);
  doc.roundedRect(x - w / 2, y - 4, w, 7, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...BLANCO);
  doc.text(label, x, y + 0.5, { align: "center" });
}

interface ItemGridImagen {
  dataUrl: string;
  etiqueta: string;
  comentarios: string[];
  size: { w: number; h: number };
}

// Dibuja imágenes en una cuadrícula de 2 columnas con etiqueta y observaciones
// debajo de cada una. Compartido entre fotos, avances diarios y páginas
// renderizadas de documentos PDF, para no triplicar el mismo layout.
function dibujarGridImagenes(doc: jsPDF, items: ItemGridImagen[], y: number, PW: number): number {
  const COLS   = 2;
  const MARGIN = 15;
  const GAP    = 8;
  const COL_W  = (PW - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const MAX_H  = 65;
  const OBS_H  = 28;

  for (let i = 0; i < items.length; i++) {
    const col  = i % COLS;
    const xImg = MARGIN + col * (COL_W + GAP);

    if (col === 0 && i > 0) y += MAX_H + OBS_H + 8;
    y = checkPage(doc, y, MAX_H + OBS_H + 10);

    const item = items[i];
    let imgW = COL_W;
    let imgH = (imgW * item.size.h) / item.size.w;
    if (imgH > MAX_H) { imgH = MAX_H; imgW = (imgH * item.size.w) / item.size.h; }
    const xCentered = xImg + (COL_W - imgW) / 2;

    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.5);
    doc.rect(xCentered - 1, y - 1, imgW + 2, imgH + 2, "S");
    try {
      const ext = item.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(item.dataUrl, ext, xCentered, y, imgW, imgH);
    } catch {
      doc.setFillColor(...GRIS_L);
      doc.rect(xCentered, y, imgW, imgH, "F");
      doc.setFontSize(7);
      doc.setTextColor(...GRIS);
      doc.text("[imagen no disponible]", xCentered + imgW / 2, y + imgH / 2, { align: "center" });
    }

    const yObs = y + imgH + 3;
    doc.setFillColor(248, 250, 252);
    doc.rect(xImg, yObs, COL_W, OBS_H - 4, "F");
    doc.setDrawColor(...BORDE);
    doc.setLineWidth(0.3);
    doc.rect(xImg, yObs, COL_W, OBS_H - 4, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...NAVY);
    doc.text(item.etiqueta, xImg + 2, yObs + 4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(...GRIS);
    doc.text("Observaciones:", xImg + 2, yObs + 8.5);

    const textoObs = item.comentarios.filter(Boolean).join(" · ") || "Sin observaciones";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...NEGRO);
    doc.text(doc.splitTextToSize(textoObs, COL_W - 4).slice(0, 3), xImg + 2, yObs + 13);
  }

  if (items.length > 0) y += MAX_H + OBS_H + 6;
  return y;
}

// Dibuja una página de documento PDF a tamaño completo (una hoja del informe por
// cada página del PDF), a diferencia de dibujarGridImagenes: el grid a 2 columnas
// achica demasiado el contenido de un documento y lo vuelve ilegible.
function dibujarPaginaPdfCompleta(doc: jsPDF, item: ItemGridImagen, PW: number): void {
  doc.addPage();
  const PH = doc.internal.pageSize.getHeight();
  const MARGIN = 15;
  let y = 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...GRIS);
  doc.text("VISTA PREVIA DE DOCUMENTO PDF", MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text(item.etiqueta, MARGIN, y);
  y += 6;

  const OBS_H  = 22;
  const maxW   = PW - MARGIN * 2;
  const maxH   = PH - y - OBS_H - 15;

  let imgW = maxW;
  let imgH = (imgW * item.size.h) / item.size.w;
  if (imgH > maxH) { imgH = maxH; imgW = (imgH * item.size.w) / item.size.h; }
  const xCentered = MARGIN + (maxW - imgW) / 2;

  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.5);
  doc.rect(xCentered - 1, y - 1, imgW + 2, imgH + 2, "S");
  try {
    const ext = item.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    doc.addImage(item.dataUrl, ext, xCentered, y, imgW, imgH);
  } catch {
    doc.setFillColor(...GRIS_L);
    doc.rect(xCentered, y, imgW, imgH, "F");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text("[imagen no disponible]", xCentered + imgW / 2, y + imgH / 2, { align: "center" });
  }

  const yObs = y + imgH + 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...GRIS);
  doc.text("Observaciones:", MARGIN, yObs);

  const textoObs = item.comentarios.filter(Boolean).join(" · ") || "Sin observaciones";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...NEGRO);
  doc.text(doc.splitTextToSize(textoObs, maxW), MARGIN, yObs + 5);
}

function checkPage(doc: jsPDF, y: number, espacio: number): number {
  const PH = doc.internal.pageSize.getHeight();
  if (y + espacio > PH - 18) { doc.addPage(); return 20; }
  return y;
}

function piePagina(doc: jsPDF, numOT: string) {
  const totalPages = doc.getNumberOfPages();
  const PW = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const PH = doc.internal.pageSize.getHeight();
    doc.setFillColor(...NAVY);
    doc.rect(0, PH - 10, PW, 10, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...BLANCO);
    doc.text(`SYNC MSC · Informe de Cierre OT ${numOT} · Generado ${new Date().toLocaleDateString("es-BO")}`, 15, PH - 3.5);
    doc.text(`Pág. ${i} / ${totalPages}`, PW - 15, PH - 3.5, { align: "right" });
  }
}

// ── Generador principal (async para leer dimensiones reales de imágenes) ──────
export async function generarInformeOT(ot: OTData): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  let y = 15;

  const numOT = ot.otJdeNumero ?? ot.numeroOT ?? "—";
  const tecnicos = [...new Set(ot.tecnicos.map(t => t.nombreCompleto))].join(", ") || "—";
  const correctivos = ot.lineas.filter(l => ["CMP", "CMR"].includes(l.tipoOT));
  const preventivos = ot.lineas.filter(l => !["CMP", "CMR"].includes(l.tipoOT));
  const tieneCorrectivos = correctivos.length > 0;
  // Si la OT tiene avances diarios, el detalle día a día (tareas ejecutadas, HH
  // estimadas y reales por jornada) ya se muestra completo en "3. Avances Diarios"
  // — mostrar HH Est./HH Real por línea de equipo en el punto 2 es redundante y
  // confunde con el total semanal real.
  const tieneAvancesDiarios = (ot.registrosDiarios ?? []).length > 0;

  // Nombre supervisor desde historial (no el CUID guardado en revisadoPor)
  const entradaRevision = (ot.historialCambios ?? [])
    .slice().reverse()
    .find(c => /revisado|aprobad|concluid/i.test(c.cambio));
  const sup = entradaRevision?.nombreUsuario ?? ot.datosSupervision?.revisadoPor ?? "—";
  const fechaRevision = ot.datosSupervision?.revisadoEn
    ? fmt(ot.datosSupervision.revisadoEn)
    : entradaRevision?.fechaHora ? fmt(entradaRevision.fechaHora) : "—";

  // Adjuntos de todas las líneas
  const todosAdjuntos = ot.lineas.flatMap(l =>
    (l.adjuntos ?? []).map(a => ({ ...a, tag: l.tag }))
  );
  const fotos      = todosAdjuntos.filter(a => a.tipo === "foto");
  const documentos = todosAdjuntos.filter(a => a.tipo === "documento");

  // Adjuntos de avances diarios agrupados por día
  const diarioConAdj = (ot.registrosDiarios ?? []).filter(r => (r.adjuntos ?? []).length > 0);
  const fotosDiarios = diarioConAdj.flatMap(r =>
    (r.adjuntos ?? []).filter(a => a.tipo === "foto").map(a => ({ ...a, tag: fmt(r.fecha), fecha: r.fecha }))
  );
  const docsDiarios = diarioConAdj.flatMap(r =>
    (r.adjuntos ?? []).filter(a => a.tipo === "documento").map(a => ({ ...a, tag: fmt(r.fecha), fecha: r.fecha }))
  );

  // Pre-cargar dimensiones reales de todas las fotos (async, antes de generar el PDF)
  const fotoSizes        = await Promise.all(fotos.map(f => getImgSize(f.dataUrl)));
  const fotoSizesDiarios = await Promise.all(fotosDiarios.map(f => getImgSize(f.dataUrl)));

  // Documentos PDF: se renderiza cada página como imagen para incrustar el
  // contenido visual en el informe, igual que las fotos. Si el render falla
  // (PDF corrupto, protegido, etc.) el documento igual queda listado en la
  // tabla de "Documentos adjuntos" más abajo.
  async function renderizarDocumentosPdf<T extends { tipo: string; nombre: string; dataUrl: string; comentario: string; comentariosExtra: string[]; tag: string }>(
    docs: T[]
  ) {
    const resultado: { tag: string; nombre: string; comentario: string; comentariosExtra: string[]; imagen: string; pagina: number; totalPaginas: number }[] = [];
    for (const d of docs) {
      if (!d.dataUrl.startsWith("data:application/pdf")) continue;
      try {
        // Import dinámico: pdfjs-dist toca APIs de navegador (DOMMatrix, canvas)
        // al evaluarse. Un import estático rompe el prerenderizado en el
        // servidor de cualquier página que use generarInformeOT.
        const { renderizarPaginasPdf } = await import("./pdfToImages");
        const paginas = await renderizarPaginasPdf(d.dataUrl);
        paginas.forEach((imagen, idx) => {
          resultado.push({ tag: d.tag, nombre: d.nombre, comentario: d.comentario, comentariosExtra: d.comentariosExtra, imagen, pagina: idx + 1, totalPaginas: paginas.length });
        });
      } catch { /* se mantiene solo en la tabla de documentos */ }
    }
    return resultado;
  }

  const paginasDocumentos        = await renderizarDocumentosPdf(documentos);
  const paginasDocumentosDiarios = await renderizarDocumentosPdf(docsDiarios);
  const sizesPaginasDocumentos        = await Promise.all(paginasDocumentos.map(p => getImgSize(p.imagen)));
  const sizesPaginasDocumentosDiarios = await Promise.all(paginasDocumentosDiarios.map(p => getImgSize(p.imagen)));

  // ── Encabezado ───────────────────────────────────────────────────────────────
  doc.setFillColor(...HDR_TOP);
  doc.rect(0, 0, PW, 5, "F");
  doc.setFillColor(...HDR_BG);
  doc.rect(0, 5, PW, 24, "F");
  doc.setFillColor(...AZUL);
  doc.rect(0, 29, PW, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text("SYNC MSC", 15, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...HDR_TOP);
  doc.text("Sistema de Gestión de Mantenimiento", 15, 20);
  doc.text("Informe de Cierre de Orden de Trabajo", 15, 25.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text(`OT ${numOT}`, PW - 15, 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...HDR_TOP);
  doc.text(fmt(ot.fecha), PW - 15, 21, { align: "right" });
  estadoBadge(doc, ot.estado, PW - 30, 27);

  y = 38;

  // ── 1. DATOS GENERALES ──────────────────────────────────────────────────────
  seccion(doc, "1. Datos Generales", y, PW);
  y += 14;

  autoTable(doc, {
    startY: y,
    margin: { left: 15, right: 15 },
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 } },
    columnStyles: {
      0: { fontStyle: "bold", textColor: GRIS, cellWidth: 42 },
      1: { textColor: NEGRO },
      2: { fontStyle: "bold", textColor: GRIS, cellWidth: 42 },
      3: { textColor: NEGRO },
    },
    body: [
      ["N° OT OPEPLANT", numOT, "Fecha", fmt(ot.fecha)],
      ["Turno", ot.turno, "Área", ot.areaCodigo],
      ["Técnico(s)", tecnicos || "—", "Revisado por", sup],
      ["Estado", ESTADO_LABEL[ot.estado] ?? ot.estado, "Fecha revisión", fechaRevision],
    ],
    didParseCell: (data) => {
      if (data.row.index % 2 === 0 && data.section === "body")
        data.cell.styles.fillColor = GRIS_L;
    },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── 2. EQUIPOS INTERVENIDOS ─────────────────────────────────────────────────
  y = checkPage(doc, y, 35);
  seccion(doc, "2. Equipos Intervenidos", y, PW);
  y += 14;

  if (correctivos.length > 0) {
    // ── CMR — Correctivos Menores con árbol de fallas ──────────────────────
    const cmr = correctivos.filter(l => l.tipoOT === "CMR");
    if (cmr.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...AZUL);
      doc.text("Correctivos Menores Rutinarios (CMR) — Árbol de Fallas", 15, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        margin: { left: 15, right: 15 },
        head: tieneAvancesDiarios
          ? [["TAG / Equipo", "Síntoma / Modo de Falla", "Causa Probable", "Resolución Aplicada", "Tareas Ejecutadas"]]
          : [["TAG / Equipo", "Síntoma / Modo de Falla", "Causa Probable", "Resolución Aplicada", "Tareas Ejecutadas", "HH Est.", "HH Real"]],
        body: cmr.map(l => tieneAvancesDiarios
          ? [
            `${l.tag}\n${l.descripcionEquipo}`,
            l.sintoma ?? "—",
            l.causaProbable ?? "—",
            l.resolucionAplicada ?? "—",
            (l.tareasEjecutadas ?? []).join("\n") || "—",
          ]
          : [
            `${l.tag}\n${l.descripcionEquipo}`,
            l.sintoma ?? "—",
            l.causaProbable ?? "—",
            l.resolucionAplicada ?? "—",
            (l.tareasEjecutadas ?? []).join("\n") || "—",
            fmtHrs(l.tiempoEstimadoHrs),
            fmtHrs(l.tiempoRealHrs),
          ]),
        headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
        bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: NEGRO },
        alternateRowStyles: { fillColor: GRIS_L },
        columnStyles: tieneAvancesDiarios
          ? {
            0: { cellWidth: 30, fontStyle: "bold" },
            1: { cellWidth: 34 },
            2: { cellWidth: 30 },
            3: { cellWidth: 38 },
            4: { cellWidth: 30 },
          }
          : {
            0: { cellWidth: 27, fontStyle: "bold" },
            1: { cellWidth: 29 },
            2: { cellWidth: 26 },
            3: { cellWidth: 32 },
            4: { cellWidth: 26 },
            5: { cellWidth: 13, halign: "center" },
            6: { cellWidth: 13, halign: "center" },
          },
      });
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    }

    // ── CMP — Correctivos Mayores Programados ──────────────────────────────
    const cmp = correctivos.filter(l => l.tipoOT === "CMP");
    if (cmp.length > 0) {
      y = checkPage(doc, y, 30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...AZUL);
      doc.text("Correctivos Mayores Programados (CMP)", 15, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        margin: { left: 15, right: 15 },
        head: tieneAvancesDiarios
          ? [["TAG / Equipo", "Descripción del Trabajo", "Resolución / Resultado", "Tareas Ejecutadas"]]
          : [["TAG / Equipo", "Descripción del Trabajo", "Resolución / Resultado", "Tareas Ejecutadas", "HH Est.", "HH Real"]],
        body: cmp.map(l => tieneAvancesDiarios
          ? [
            `${l.tag}\n${l.descripcionEquipo}`,
            l.descripcionTrabajo ?? l.sintoma ?? "—",
            l.resolucionAplicada ?? "—",
            (l.tareasEjecutadas ?? []).join("\n") || "—",
          ]
          : [
            `${l.tag}\n${l.descripcionEquipo}`,
            l.descripcionTrabajo ?? l.sintoma ?? "—",
            l.resolucionAplicada ?? "—",
            (l.tareasEjecutadas ?? []).join("\n") || "—",
            fmtHrs(l.tiempoEstimadoHrs),
            fmtHrs(l.tiempoRealHrs),
          ]),
        headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
        bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: NEGRO },
        alternateRowStyles: { fillColor: GRIS_L },
        columnStyles: tieneAvancesDiarios
          ? {
            0: { cellWidth: 32, fontStyle: "bold" },
            1: { cellWidth: 52 },
            2: { cellWidth: 48 },
            3: { cellWidth: 33 },
          }
          : {
            0: { cellWidth: 26, fontStyle: "bold" },
            1: { cellWidth: 44 },
            2: { cellWidth: 40 },
            3: { cellWidth: 30 },
            4: { cellWidth: 13, halign: "center" },
            5: { cellWidth: 13, halign: "center" },
          },
      });
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    }
  }

  if (preventivos.length > 0) {
    y = checkPage(doc, y, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...AZUL);
    doc.text("Trabajos Preventivos / Predictivos", 15, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      margin: { left: 15, right: 15 },
      head: tieneAvancesDiarios
        ? [["TAG / Equipo", "Tipo", "Descripción del Trabajo"]]
        : [["TAG / Equipo", "Tipo", "Descripción del Trabajo", "Tareas Ejecutadas", "HH Real"]],
      body: preventivos.map(l => tieneAvancesDiarios
        ? [
          `${l.tag}\n${l.descripcionEquipo}`,
          l.tipoOT,
          l.descripcionTrabajo ?? "—",
        ]
        : [
          `${l.tag}\n${l.descripcionEquipo}`,
          l.tipoOT,
          l.descripcionTrabajo ?? "—",
          (l.tareasEjecutadas ?? []).join("\n") || "—",
          fmtHrs(l.tiempoRealHrs),
        ]),
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: NEGRO },
      alternateRowStyles: { fillColor: GRIS_L },
      columnStyles: tieneAvancesDiarios
        ? {
          0: { cellWidth: 40, fontStyle: "bold" },
          1: { cellWidth: 20, halign: "center" },
          2: { cellWidth: 105 },
        }
        : {
          0: { cellWidth: 32, fontStyle: "bold" },
          1: { cellWidth: 14, halign: "center" },
          2: { cellWidth: 50 },
          3: { cellWidth: 50 },
          4: { cellWidth: 18, halign: "center" },
        },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  }

  // ── 3. AVANCES DIARIOS (si hay registros) ───────────────────────────────────
  const diarios = ot.registrosDiarios ?? [];
  if (diarios.length > 0) {
    y = checkPage(doc, y, 30);
    seccion(doc, "3. Avances Diarios", y, PW);
    y += 14;

    autoTable(doc, {
      startY: y,
      margin: { left: 15, right: 15 },
      head: [["Fecha", "Técnico", "HH", "Tareas Ejecutadas / Observaciones"]],
      body: diarios.map(r => {
        const tareas = (r.tareasEjecutadas ?? []).join("\n");
        const obs = r.observaciones?.trim() ?? "";
        const detalle = [tareas, obs].filter(Boolean).join("\n") || "—";
        return [
          fmt(r.fecha),
          r.tecnico,
          `${r.hhTrabajadas} h`,
          detalle,
        ];
      }),
      headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: NEGRO, overflow: "linebreak" },
      alternateRowStyles: { fillColor: GRIS_L },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" },
        1: { cellWidth: 38 },
        2: { cellWidth: 14, halign: "center" },
        3: { cellWidth: 96 },
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    // ── Fotos y documentos de los avances diarios ──────────────────────────
    if (fotosDiarios.length > 0 || docsDiarios.length > 0) {
      y = checkPage(doc, y, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...AZUL);
      doc.text("Evidencias de Avances Diarios", 15, y);
      y += 7;

      if (fotosDiarios.length > 0) {
        y = dibujarGridImagenes(doc, fotosDiarios.map((adj, i) => ({
          dataUrl: adj.dataUrl,
          etiqueta: `Avance: ${adj.tag}`,
          comentarios: [adj.comentario, ...(adj.comentariosExtra ?? [])],
          size: fotoSizesDiarios[i] ?? { w: 4, h: 3 },
        })), y, PW);
      }

      if (paginasDocumentosDiarios.length > 0) {
        paginasDocumentosDiarios.forEach((p, i) => {
          dibujarPaginaPdfCompleta(doc, {
            dataUrl: p.imagen,
            etiqueta: p.totalPaginas > 1 ? `${p.tag} · ${p.nombre} (pág. ${p.pagina}/${p.totalPaginas})` : `${p.tag} · ${p.nombre}`,
            comentarios: [p.comentario, ...(p.comentariosExtra ?? [])],
            size: sizesPaginasDocumentosDiarios[i] ?? { w: 4, h: 3 },
          }, PW);
        });
        y = doc.internal.pageSize.getHeight(); // forzar nueva página para lo que sigue
      }

      if (docsDiarios.length > 0) {
        y = checkPage(doc, y, 20);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...AZUL);
        doc.text(`Documentos adjuntos en avances — ${docsDiarios.length}`, 15, y);
        y += 5;
        autoTable(doc, {
          startY: y,
          margin: { left: 15, right: 15 },
          head: [["Fecha", "Archivo", "Observaciones"]],
          body: docsDiarios.map(d => [
            d.tag,
            d.nombre,
            [d.comentario, ...(d.comentariosExtra ?? [])].filter(Boolean).join(" · ") || "—",
          ]),
          headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
          bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: NEGRO },
          alternateRowStyles: { fillColor: GRIS_L },
          columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 60 } },
        });
        y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      }
    }
  }

  // ── SUPERVISIÓN ─────────────────────────────────────────────────────────────
  const ds = ot.datosSupervision ?? {};
  const comentarios = (ds.comentariosSupervisor ?? "").split("\n").filter(Boolean);
  const hayDatosSupervision = tieneCorrectivos && (ds.requierePlanificacion || comentarios.length > 0);

  const secSupervision = diarios.length > 0 ? 4 : 3;
  void secSupervision;
  if (hayDatosSupervision) {
    y = checkPage(doc, y, 40);
    seccion(doc, `${secSupervision}. Supervisión`, y, PW);
    y += 14;

    const supRows: [string, string][] = [];
    supRows.push(["Requiere WR", ds.requierePlanificacion ? "Sí" : "No"]);
    comentarios.forEach((c, i) => {
      supRows.push([i === 0 ? "Comentarios del Supervisor" : "", c]);
    });

    autoTable(doc, {
      startY: y,
      margin: { left: 15, right: 15 },
      theme: "plain",
      styles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 } },
      columnStyles: {
        0: { fontStyle: "bold", textColor: GRIS, cellWidth: 55 },
        1: { textColor: NEGRO },
      },
      body: supRows,
      didParseCell: (data) => {
        if (data.row.index % 2 === 0 && data.section === "body")
          data.cell.styles.fillColor = GRIS_L;
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ── RESUMEN HORAS-HOMBRE ────────────────────────────────────────────────────
  y = checkPage(doc, y, 45);
  let secNum = (diarios.length > 0 ? 1 : 0) + (hayDatosSupervision ? 1 : 0) + 3;
  seccion(doc, `${secNum}. Resumen de Horas-Hombre`, y, PW);
  y += 14;

  const totalEst  = ot.hhEstimadasPlan ?? ot.lineas.reduce((s, l) => s + (l.tiempoEstimadoHrs ?? 0), 0);
  const hhLineas  = ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
  const hhDiarios = (ot.registrosDiarios ?? []).reduce((s, r) => s + (r.hhTrabajadas ?? 0), 0);
  // El día 1 ya queda registrado como el primer registroDiario (ver POST /api/ordenes),
  // así que lineas[].tiempoRealHrs solo se suma aparte cuando todavía no hay ningún
  // registro diario (misma regla que ordenes/reporte/page.tsx para evitar duplicar el día 1).
  const totalReal = hhDiarios > 0 ? hhDiarios : hhLineas;
  const diff      = Math.round((totalReal - totalEst) * 10) / 10;
  const pct       = totalEst > 0 ? Math.round((totalReal / totalEst) * 100) : 0;

  autoTable(doc, {
    startY: y,
    margin: { left: 15, right: 80 },
    head: [["Concepto", "Valor"]],
    body: [
      ["HH Estimadas (total)", totalEst > 0 ? `${totalEst} h` : "—"],
      ["HH Reales (total)", totalReal > 0 ? `${totalReal} h` : "—"],
      ["Diferencia", totalEst > 0 ? `${diff >= 0 ? "+" : ""}${diff} h` : "—"],
      ["Eficiencia (Est. vs Real)", totalEst > 0 ? `${pct}%` : "—"],
    ],
    headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 8, fontStyle: "bold", cellPadding: 3 },
    bodyStyles: { fontSize: 9, cellPadding: 3, textColor: NEGRO },
    alternateRowStyles: { fillColor: GRIS_L },
    columnStyles: {
      0: { fontStyle: "bold", textColor: GRIS, cellWidth: 70 },
      1: { halign: "right", fontStyle: "bold", textColor: AZUL },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        const val = String(data.cell.raw ?? "");
        if (val.startsWith("+")) data.cell.styles.textColor = VERDE;
        else if (val.startsWith("-")) data.cell.styles.textColor = ROJO;
      }
    },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ── 5. EVIDENCIAS — siempre empieza en página nueva ─────────────────────────
  if (todosAdjuntos.length > 0) {
    secNum = hayDatosSupervision ? 5 : 4;

    // Forzar nueva página para la sección de evidencias
    doc.addPage();
    y = 20;

    seccion(doc, `${secNum}. Evidencias Fotográficas y Documentos`, y, PW);
    y += 14;

    // ── Fotos ──────────────────────────────────────────────────────────────
    if (fotos.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...AZUL);
      doc.text(`Registro fotográfico — ${fotos.length} imagen${fotos.length > 1 ? "es" : ""}`, 15, y);
      y += 7;

      y = dibujarGridImagenes(doc, fotos.map((adj, i) => ({
        dataUrl: adj.dataUrl,
        etiqueta: `TAG: ${adj.tag}`,
        comentarios: [adj.comentario, ...(adj.comentariosExtra ?? [])],
        size: fotoSizes[i] ?? { w: 4, h: 3 },
      })), y, PW);
    }

    // ── Vista previa de documentos PDF (contenido incrustado como imagen,
    //    una hoja del informe por cada página del PDF para que sea legible) ──
    if (paginasDocumentos.length > 0) {
      paginasDocumentos.forEach((p, i) => {
        dibujarPaginaPdfCompleta(doc, {
          dataUrl: p.imagen,
          etiqueta: p.totalPaginas > 1 ? `${p.tag} · ${p.nombre} (pág. ${p.pagina}/${p.totalPaginas})` : `${p.tag} · ${p.nombre}`,
          comentarios: [p.comentario, ...(p.comentariosExtra ?? [])],
          size: sizesPaginasDocumentos[i] ?? { w: 4, h: 3 },
        }, PW);
      });
      y = doc.internal.pageSize.getHeight(); // forzar nueva página para lo que sigue
    }

    // ── Documentos ─────────────────────────────────────────────────────────
    if (documentos.length > 0) {
      y = checkPage(doc, y, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...AZUL);
      doc.text(`Documentos adjuntos — ${documentos.length}`, 15, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        margin: { left: 15, right: 15 },
        head: [["TAG", "Archivo", "Observaciones"]],
        body: documentos.map(d => [
          d.tag,
          d.nombre,
          [d.comentario, ...(d.comentariosExtra ?? [])].filter(Boolean).join(" · ") || "—",
        ]),
        headStyles: { fillColor: NAVY, textColor: BLANCO, fontSize: 7, fontStyle: "bold", cellPadding: 2.5 },
        bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: NEGRO },
        alternateRowStyles: { fillColor: GRIS_L },
        columnStyles: {
          0: { cellWidth: 25, fontStyle: "bold" },
          1: { cellWidth: 60 },
          2: {},
        },
      });
    }
  }

  // ── Pie de página en todas las páginas (sin firmas) ──────────────────────────
  piePagina(doc, numOT);

  doc.save(`Informe_OT_${numOT}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
