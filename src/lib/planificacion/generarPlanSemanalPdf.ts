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

const MAX_PAGINAS = 2;

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
// horizontal - 16.4mm de márgenes de 8mm a cada lado).
const COLS = [
  { header: "N° OT",                 width: 16 },
  { header: "Tipo OT",                width: 12 },
  { header: "Tipo Trabajo",           width: 13 },
  { header: "Prioridad",              width: 12 },
  { header: "Descripción de Trabajo", width: 42 },
  { header: "Equipo",                 width: 16 },
  { header: "Descripción de Equipo",  width: 30 },
  { header: "Pers.",                  width: 9 },
  { header: "Hr Trab.",               width: 10 },
  { header: "Hr Total",               width: 11 },
  { header: "Personal",               width: 92 },
];

/**
 * Plan semanal continuo, en hoja carta horizontal, acotado a un máximo de 2
 * hojas: los días fluyen uno después del otro en el mismo documento — sin
 * salto de página forzado por día. Cada día agrupa sus OTs por bloque
 * (GRUPO 1-4 / TURNO DIURNO / TURNO NOCTURNO) con una fila de UTILIZACIÓN
 * combinada al final. El tamaño de fuente/fila se calcula según el total de
 * filas para que todo entre en 2 hojas, y el texto largo (p.ej. Tipo
 * Trabajo) se trunca en una sola línea en vez de agrandar la fila. El
 * encabezado y el pie siguen el mismo estilo profesional (navy/azul, sin
 * colores tipo Excel) que src/lib/generarInformeOT.ts. Se abre en pestaña
 * nueva (preview del visor nativo del navegador) para revisar antes de
 * descargar.
 */
export async function generarPlanSemanalPdf(plan: Plan, cuadrilla: CuadrillaMatriz): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
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
  const TOP_RESERVA_CONT = MARGEN + 6; // margen superior en páginas 2+ (sin encabezado)
  const RESERVA_PIE = ALTO_PIE + MARGEN + 4;
  const ALTO_UTIL_POR_HOJA = PH - TOP_RESERVA_CONT - RESERVA_PIE;
  const Y_INICIO = MARGEN + ALTO_ENCABEZADO + 4; // debajo del encabezado, solo hoja 1
  const ALTO_BANNER = Y_INICIO - TOP_RESERVA_CONT; // costo extra del encabezado vs. una página de continuación
  const ALTO_BARRAS_DIA = DIAS_SEMANA.length * 7;
  const ALTO_HEADERS = DIAS_SEMANA.length * 6;
  const alturaDisponible = ALTO_UTIL_POR_HOJA * MAX_PAGINAS - ALTO_BANNER - ALTO_BARRAS_DIA - ALTO_HEADERS;
  const altoFila = Math.max(alturaDisponible / Math.max(totalFilas, 1), 2.0);
  const fontSize = Math.min(6.5, Math.max(3.0, altoFila / 1.7));
  const cellPadding = Math.min(1.4, Math.max(0.25, fontSize * 0.22));

  encabezado(doc, plan, PW);
  let y = Y_INICIO;

  for (const { dia, body } of diasBody) {
    y = checkPage(doc, y, 16);

    doc.setFillColor(...NAVY);
    doc.rect(MARGEN, y, PW - MARGEN * 2, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BLANCO);
    doc.text(fechaLarga(plan.semana, plan.anio, dia), MARGEN + 2, y + 4.6);
    y += 6.5;

    autoTable(doc, {
      startY: y,
      margin: { left: MARGEN, right: MARGEN, bottom: RESERVA_PIE, top: TOP_RESERVA_CONT },
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
