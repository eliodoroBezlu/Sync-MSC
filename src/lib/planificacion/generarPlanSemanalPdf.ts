import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import type { Plan, CuadrillaMatriz, OtBorrador } from "@/app/planificacion/[id]/types";
import { DIAS_SEMANA, grupoDelDia } from "./cuadrillas";
import { calcularReporteCapacidad, hhPorDia } from "./capacidad";

// Misma paleta que src/lib/generarInformeOT.ts, para que ambos documentos
// se vean como parte del mismo sistema (nada de amarillos ni colores Excel).
const NAVY    = [13, 47, 94]     as [number, number, number];
const AZUL    = [37, 99, 235]    as [number, number, number];
const HDR_BG  = [235, 242, 255]  as [number, number, number];
const HDR_TOP = [59, 100, 165]   as [number, number, number];
const BLANCO  = [255, 255, 255]  as [number, number, number];
const NEGRO   = [17, 24, 39]     as [number, number, number];
const GRIS    = [107, 114, 128]  as [number, number, number];
const GRIS_L  = [241, 245, 249]  as [number, number, number];
const BORDE   = [226, 232, 240]  as [number, number, number];
const VERDE   = [22, 163, 74]    as [number, number, number];
const NARANJA_GRUPO = [237, 125, 49] as [number, number, number];
const AZUL_DIURNO   = [189, 215, 238] as [number, number, number];
const AZUL_NOCTURNO = [142, 169, 219] as [number, number, number];

// Margen uniforme (arriba/abajo/izq/der): deja una franja en blanco junto al
// borde físico de la hoja para que ninguna impresora recorte el encabezado
// ni el pie — antes el pie llegaba hasta el borde y por eso no imprimía bien.
const MARGEN = 8;
const ALTO_ENCABEZADO = 17; // banda superior (sin la línea de acento)
const ALTO_PIE = 9;

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

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function lunesDeSemana(semana: number, anio: number): Date {
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  return lunes;
}

function fechaLarga(semana: number, anio: number, diaCodigo: string): string {
  const lunes = lunesDeSemana(semana, anio);
  const offset = DIAS_SEMANA.indexOf(diaCodigo);
  const fecha = new Date(lunes);
  fecha.setDate(lunes.getDate() + offset);
  return `${DIA_NOMBRE[diaCodigo]}, ${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

function rangoSemana(semana: number, anio: number): string {
  const lunes = lunesDeSemana(semana, anio);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  const mismoMes = lunes.getMonth() === domingo.getMonth();
  const inicio = mismoMes ? `${lunes.getDate()}` : `${lunes.getDate()} ${MESES[lunes.getMonth()]}`;
  return `${inicio} – ${domingo.getDate()} ${MESES[domingo.getMonth()]} ${anio}`;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function checkPage(doc: jsPDF, y: number, espacio: number): number {
  const PH = doc.internal.pageSize.getHeight();
  const limiteInferior = PH - MARGEN - ALTO_PIE - 4;
  if (y + espacio > limiteInferior) { doc.addPage(); return MARGEN + 6; }
  return y;
}

// Encabezado tipo "reporte de OT": franja azul-navy fina + banda clara con
// el branding a la izquierda y el dato de semana a la derecha. Sin amarillos.
function encabezado(doc: jsPDF, plan: Plan, PW: number): void {
  doc.setFillColor(...HDR_TOP);
  doc.rect(MARGEN, MARGEN, PW - MARGEN * 2, 3, "F");
  doc.setFillColor(...HDR_BG);
  doc.rect(MARGEN, MARGEN + 3, PW - MARGEN * 2, ALTO_ENCABEZADO - 4, "F");
  doc.setFillColor(...AZUL);
  doc.rect(MARGEN, MARGEN + ALTO_ENCABEZADO - 1, PW - MARGEN * 2, 1, "F");

  const xIzq = MARGEN + 3;
  const xDer = PW - MARGEN - 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text("SYNC MSC", xIzq, MARGEN + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...HDR_TOP);
  doc.text("Sistema de Gestión de Mantenimiento", xIzq, MARGEN + 13.5);
  doc.text(`Plan Semanal — ${plan.disciplina.toUpperCase()} ${plan.areaCodigo.toUpperCase()}`, xIzq, MARGEN + 15.9);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...NAVY);
  doc.text(`SEMANA ${plan.semana} / ${plan.anio}`, xDer, MARGEN + 9.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...HDR_TOP);
  doc.text(rangoSemana(plan.semana, plan.anio), xDer, MARGEN + 15, { align: "right" });
}

function piePagina(doc: jsPDF, titulo: string) {
  const totalPages = doc.getNumberOfPages();
  const PW = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const PH = doc.internal.pageSize.getHeight();
    const yPie = PH - MARGEN - ALTO_PIE;
    doc.setFillColor(...NAVY);
    doc.rect(MARGEN, yPie, PW - MARGEN * 2, ALTO_PIE, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...BLANCO);
    doc.text(`SYNC MSC · ${titulo} · Generado ${new Date().toLocaleDateString("es-BO")}`, MARGEN + 3, yPie + ALTO_PIE - 3);
    doc.text(`Pág. ${i} / ${totalPages}`, PW - MARGEN - 3, yPie + ALTO_PIE - 3, { align: "right" });
  }
}

// Anchos pensados para hoja carta horizontal (263mm útiles = 279.4mm carta
// horizontal - 16.4mm de márgenes de 8mm a cada lado). "Tipo OT"/"Prioridad"
// y "Hr Trab."/"Hr Total" se fusionan en una sola columna cada par para
// liberar ancho y poder imprimir con una letra legible (10pt, como el Excel
// de referencia) en vez de achicar el texto para forzar 2 hojas. "Equipo"
// (el TAG) nunca debe truncarse, así que tiene ancho generoso a costa de
// "Tipo / Prior." (poco importante) y "Personal".
const COLS = [
  { header: "N° OT",                 width: 18 },
  { header: "Tipo / Prior.",         width: 14 },
  { header: "Descripción de Trabajo", width: 46 },
  { header: "Equipo",                 width: 28 },
  { header: "Descripción de Equipo",  width: 32 },
  { header: "Pers.",                  width: 10 },
  { header: "Hr Trab./Prog.",         width: 16 },
  { header: "Personal",               width: 99 },
];

/**
 * Plan semanal continuo, en hoja carta horizontal: los días fluyen uno
 * después del otro en el mismo documento — sin salto de página forzado por
 * día. Cada día agrupa sus OTs por bloque (GRUPO 1-4 / TURNO DIURNO / TURNO
 * NOCTURNO) con una fila de UTILIZACIÓN combinada al final. Prioriza la
 * legibilidad en papel (letra cercana a 10pt, como el Excel de referencia)
 * ya que este documento se imprime y se publica para que el personal lo
 * lea — por eso las columnas se consolidan en vez de achicar el texto, y el
 * documento puede ocupar más de 2 hojas si la semana tiene muchas OTs. El
 * texto largo (p.ej. Descripción de Equipo) se trunca en una sola línea en
 * vez de agrandar la fila. El encabezado y el pie siguen el mismo estilo
 * profesional (navy/azul, sin colores tipo Excel) que
 * src/lib/generarInformeOT.ts. Se abre en pestaña nueva (preview del visor
 * nativo del navegador) para revisar antes de descargar.
 */
export async function generarPlanSemanalPdf(plan: Plan, cuadrilla: CuadrillaMatriz): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const PW = doc.internal.pageSize.getWidth();

  const ots = plan.ots.filter(o => o.seleccionada || o.esGuardia);
  const reporte = calcularReporteCapacidad(ots, cuadrilla, plan.capacidadOverride, DIAS_SEMANA);

  const diasBody: { dia: string; body: RowInput[] }[] = [];

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
      body.push([{ content: etiquetaGrupo(grupo), colSpan: COLS.length, styles: { fillColor: colores.bg, textColor: colores.texto, fontStyle: "bold", halign: "left", fontSize: 7, cellPadding: 0.9 } }]);

      const nombresGrupoDia = new Set((cuadrilla[grupo]?.[dia] ?? []).map(t => t.nombre));
      if (otsDelBlock.length === 0) {
        body.push([{ content: "Sin OTs asignadas", colSpan: COLS.length, styles: { halign: "center", textColor: GRIS, fontStyle: "italic" } }]);
      } else {
        for (const ot of otsDelBlock as OtBorrador[]) {
          body.push([
            { content: ot.numeroOT, styles: { fontStyle: "bold" } },
            `${ot.tipoOT} / ${ot.prioridad ?? "—"}`,
            ot.descripcion,
            ot.tag,
            ot.descripcionEquipo,
            String(ot.personas),
            `${ot.hrsTrabajo} / ${fmtNum(hhPorDia(ot, dia))}`,
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
        { content: "UTILIZACIÓN", colSpan: 5, styles: { ...estiloUtil, halign: "left" } },
        { content: String(headcountTotal), styles: { ...estiloUtil, halign: "center" } },
        { content: `${fmtNum(diaResumen?.horasDisponibles ?? 0)} / ${fmtNum(diaResumen?.horasProgramadas ?? 0)}`, styles: { ...estiloUtil, halign: "center" } },
        { content: `${pct}%`, styles: { ...estiloUtil, halign: "center" } },
      ]);
    } else {
      body.push([{ content: "Sin actividad programada este día", colSpan: COLS.length, styles: { halign: "center", textColor: GRIS, fontStyle: "italic" } }]);
    }

    diasBody.push({ dia, body });
  }

  // ── Tamaño de letra fijo y legible en papel (el Excel de referencia usa
  // 10pt). Ya no se achica el texto para forzar un límite de páginas: este
  // documento se imprime y se publica para el personal, así que la
  // legibilidad manda sobre el número exacto de hojas.
  const TOP_RESERVA_CONT = MARGEN + 6; // margen superior en páginas 2+ (sin encabezado)
  const RESERVA_PIE = ALTO_PIE + MARGEN + 4;
  const Y_INICIO = MARGEN + ALTO_ENCABEZADO + 4; // debajo del encabezado, solo hoja 1
  const FUENTE_TITULOS = 10; // fechas/días de cada día, como el Excel original
  const FUENTE_CUERPO = 8;
  const CELL_PADDING = 1.3;

  encabezado(doc, plan, PW);
  let y = Y_INICIO;

  for (const { dia, body } of diasBody) {
    y = checkPage(doc, y, 16);

    doc.setFillColor(...NAVY);
    doc.rect(MARGEN, y, PW - MARGEN * 2, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FUENTE_TITULOS);
    doc.setTextColor(...BLANCO);
    doc.text(fechaLarga(plan.semana, plan.anio, dia), MARGEN + 2, y + 5.3);
    y += 7.5;

    autoTable(doc, {
      startY: y,
      margin: { left: MARGEN, right: MARGEN, bottom: RESERVA_PIE, top: TOP_RESERVA_CONT },
      head: [COLS.map(c => c.header)],
      body,
      headStyles: { fillColor: [71, 85, 105], textColor: BLANCO, fontSize: FUENTE_CUERPO, fontStyle: "bold", cellPadding: CELL_PADDING, halign: "center", overflow: "ellipsize" },
      bodyStyles: { fontSize: FUENTE_CUERPO, cellPadding: CELL_PADDING, textColor: NEGRO, overflow: "ellipsize", lineColor: BORDE, lineWidth: 0.2 },
      alternateRowStyles: { fillColor: GRIS_L },
      columnStyles: Object.fromEntries(COLS.map((c, i) => [i, { cellWidth: c.width, halign: [1, 5, 6].includes(i) ? "center" as const : "left" as const }])),
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  }

  piePagina(doc, `Plan Semanal ${plan.semana}/${plan.anio}`);

  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
