import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Plan, CuadrillaMatriz, OtBorrador } from "@/app/planificacion/[id]/types";
import { DIAS_SEMANA, grupoDelDia } from "./cuadrillas";
import { calcularReporteCapacidad, hhPorDia } from "./capacidad";

const NAVY   = [13, 47, 94]    as [number, number, number];
const BLANCO = [255, 255, 255] as [number, number, number];
const NEGRO  = [17, 24, 39]    as [number, number, number];
const GRIS_L = [248, 250, 252] as [number, number, number];
const GRIS   = [107, 114, 128] as [number, number, number];
const BORDE  = [226, 232, 240] as [number, number, number];

const GRUPOS_ORDEN = ["G1", "G2", "G3", "G4", "Diurno", "Nocturno"];
const GRUPO_COLOR: Record<string, { bg: [number, number, number]; texto: [number, number, number] }> = {
  G1:       { bg: [219, 234, 254], texto: [29, 78, 216] },
  G2:       { bg: [220, 252, 231], texto: [22, 101, 52] },
  G3:       { bg: [254, 243, 199], texto: [146, 64, 14] },
  G4:       { bg: [237, 233, 254], texto: [91, 33, 182] },
  Diurno:   { bg: [255, 237, 213], texto: [154, 52, 18] },
  Nocturno: { bg: [30, 41, 59],    texto: [226, 232, 240] },
};

const DIA_NOMBRE: Record<string, string> = {
  Lu: "LUNES", Ma: "MARTES", Mi: "MIÉRCOLES", Ju: "JUEVES", Vi: "VIERNES", Sa: "SÁBADO", Do: "DOMINGO",
};

function fechaDeDia(semana: number, anio: number, diaCodigo: string): string {
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  const offset = DIAS_SEMANA.indexOf(diaCodigo);
  const fecha = new Date(lunes);
  fecha.setDate(lunes.getDate() + offset);
  return `${fecha.getDate().toString().padStart(2, "0")}/${(fecha.getMonth() + 1).toString().padStart(2, "0")}/${fecha.getFullYear()}`;
}

function checkPage(doc: jsPDF, y: number, espacio: number): number {
  const PH = doc.internal.pageSize.getHeight();
  if (y + espacio > PH - 12) { doc.addPage(); return 14; }
  return y;
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

const COLS = [
  { header: "N° OT",                 width: 20 },
  { header: "Tipo OT",                width: 14 },
  { header: "Tipo Trabajo",           width: 16 },
  { header: "Prioridad",              width: 14 },
  { header: "Descripción de Trabajo", width: 45 },
  { header: "Equipo",                 width: 20 },
  { header: "Descripción de Equipo",  width: 35 },
  { header: "Pers.",                  width: 12 },
  { header: "Hr Trab.",               width: 12 },
  { header: "Hr Total",               width: 14 },
  { header: "Personal",               width: 75 },
];

/**
 * Plan semanal día por día (tipo hoja "I-30" del Excel de referencia): una
 * página por día, con bloques por grupo (G1-G4/Diurno/Nocturno) mostrando las
 * OTs efectivas de ese grupo ese día (respeta overrides de grupoPorDia) y una
 * fila de UTILIZACIÓN por bloque. Se abre en pestaña nueva (preview del
 * visor nativo del navegador) para revisar antes de descargar.
 */
export async function generarPlanSemanalPdf(plan: Plan, cuadrilla: CuadrillaMatriz): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();

  const ots = plan.ots.filter(o => o.seleccionada || o.esGuardia);
  const reporte = calcularReporteCapacidad(ots, cuadrilla, plan.capacidadOverride, DIAS_SEMANA);

  DIAS_SEMANA.forEach((dia, idxDia) => {
    if (idxDia > 0) doc.addPage();

    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PW, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...BLANCO);
    doc.text(`${DIA_NOMBRE[dia]} ${fechaDeDia(plan.semana, plan.anio, dia)}`, 10, 10.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Plan Semanal — Semana ${plan.semana}/${plan.anio} — ${plan.areaCodigo} / ${plan.disciplina}`, PW - 10, 10.5, { align: "right" });

    let y = 22;

    for (const grupo of GRUPOS_ORDEN) {
      const otsDelBlock = ots
        .filter(o => o.dias.includes(dia) && grupoDelDia(o, dia) === grupo)
        .sort((a, b) => a.numeroOT.localeCompare(b.numeroOT, undefined, { numeric: true }));
      const cap = reporte.porGrupoDia.find(f => f.grupo === grupo && f.dia === dia);
      if (otsDelBlock.length === 0 && (!cap || cap.headcount === 0)) continue;

      const colores = GRUPO_COLOR[grupo] ?? { bg: [241, 245, 249] as [number, number, number], texto: [71, 85, 105] as [number, number, number] };

      y = checkPage(doc, y, 20);
      doc.setFillColor(...colores.bg);
      doc.rect(10, y, PW - 20, 6.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...colores.texto);
      doc.text(`GRUPO ${grupo}`, 13, y + 4.5);
      y += 7.5;

      const nombresGrupoDia = new Set((cuadrilla[grupo]?.[dia] ?? []).map(t => t.nombre));
      const body = otsDelBlock.length > 0
        ? otsDelBlock.map((ot: OtBorrador) => [
            ot.numeroOT,
            ot.tipoOT,
            ot.tipoTrabajo,
            ot.prioridad ?? "—",
            ot.descripcion,
            ot.tag,
            ot.descripcionEquipo,
            String(ot.personas),
            String(ot.hrsTrabajo),
            hhPorDia(ot, dia).toFixed(1),
            ot.personalAsignado.filter(n => nombresGrupoDia.has(n)).join(", ") || "—",
          ])
        : [[{ content: "Sin OTs asignadas este día", colSpan: COLS.length, styles: { halign: "center" as const, textColor: GRIS, fontStyle: "italic" as const } }]];

      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        head: [COLS.map(c => c.header)],
        body,
        headStyles: { fillColor: [71, 85, 105], textColor: BLANCO, fontSize: 6.5, fontStyle: "bold", cellPadding: 1.6, halign: "center" },
        bodyStyles: { fontSize: 6.5, cellPadding: 1.6, textColor: NEGRO, overflow: "linebreak", lineColor: BORDE, lineWidth: 0.2 },
        alternateRowStyles: { fillColor: GRIS_L },
        columnStyles: Object.fromEntries(COLS.map((c, i) => [i, { cellWidth: c.width, halign: [1, 2, 3, 7, 8, 9].includes(i) ? "center" as const : "left" as const }])),
      });
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

      y = checkPage(doc, y, 10);
      const pct = cap ? Math.round(cap.utilizacion * 100) : 0;
      doc.setFillColor(...colores.bg);
      doc.rect(10, y, PW - 20, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...colores.texto);
      const resumen = cap
        ? `UTILIZACIÓN — ${cap.headcount} pers. · ${cap.horasDisponibles.toFixed(0)}h disponibles · ${cap.horasProgramadas.toFixed(1)}h programadas · ${pct}%`
        : "UTILIZACIÓN — sin datos";
      doc.text(resumen, PW - 13, y + 4.2, { align: "right" });
      y += 10;
    }

    if (y === 22) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(...GRIS);
      doc.text("Sin actividad programada este día.", 10, y + 5);
    }
  });

  piePagina(doc, `Plan Semanal ${plan.semana}/${plan.anio}`);

  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
