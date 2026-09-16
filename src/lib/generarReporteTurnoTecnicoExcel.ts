import * as XLSX from "xlsx";
import { tipoOtDisplay } from "@/lib/tiposOt";
import type { BitacoraEntry, LineaDisplay, Novedad, OTDisplay, ReporteData } from "@/app/ordenes/turno-tecnico/[id]/imprimir/PrintClientTecnico";

const ESTADO_FINAL_LABEL: Record<string, string> = {
  operativo:      "Operativo",
  operativo_obs:  "Operativo c/ observación",
  pendiente:      "Pendiente",
  fuera_servicio: "Fuera de servicio",
};

function otNum(ot: OTDisplay): string {
  return ot.otJdeNumero ?? ot.numeroOT;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Descripción del trabajo + resolución, igual que en la vista de impresión
// y en el generador de PDF (generarReporteTurnoTecnicoPdf.ts) — a diferencia
// del PDF, acá no hay restricción de charset, así que sí se puede usar texto
// libre con tildes/símbolos sin problema.
function textoDescripcion(descripcion: string | undefined, resolucion: string | undefined, estadoFinal: string | undefined): string {
  const partes = [descripcion || "—"];
  if (resolucion) {
    const label = estadoFinal ? ESTADO_FINAL_LABEL[estadoFinal] : undefined;
    partes.push(`Resuelto: ${resolucion}${label ? ` [${label}]` : ""}`);
  }
  return partes.join("\n");
}

function textoTareas(tareas: string[] | undefined, fallback: string | undefined): string {
  if (tareas && tareas.length > 0) return tareas.map(t => `- ${t}`).join("\n");
  return fallback?.trim() || "—";
}

// Item, Sección, Tipo, Equipo Tag, Hrs, OT #, Descripción del trabajo,
// Tareas ejecutadas, Estado, Crítica, Pasa a sgte. turno
type FilaOT = [string, string, string, string, string, string, string, string, string, string, string];

/**
 * Genera y descarga un Excel (.xlsx) del reporte de turno del técnico: una
 * sola hoja con una tabla plana (una fila por OT, o por línea cuando la OT
 * tiene varios equipos) — fácil de filtrar/ordenar en Excel — precedida por
 * los datos del encabezado (técnico, turno, fecha, KPIs) y seguida de las
 * novedades del turno. Reproduce el mismo agrupamiento plan/registradas que
 * la vista de impresión y el PDF.
 */
export function generarReporteTurnoTecnicoExcel(reporte: ReporteData, ots: OTDisplay[]): void {
  const res = reporte.resumenEjecutivo;

  const otsRegistradas = ots.filter(o => !o.esPlan);
  const numerosRegistrados = new Set(otsRegistradas.map(o => o.otJdeNumero ?? o.numeroOT));
  const otsPlan = ots.filter(o => o.esPlan && !numerosRegistrados.has(o.otJdeNumero ?? o.numeroOT));
  const otsPlanBitacora = otsPlan.filter(o => o.esGuardia && o.bitacora && o.bitacora.length > 0);
  const otsPlanResto = otsPlan.filter(o => !(o.esGuardia && o.bitacora && o.bitacora.length > 0));

  const filas: FilaOT[] = [];

  otsPlanResto.forEach((ot, idx) => {
    const lineas = ot.lineas && ot.lineas.length > 0 ? ot.lineas : null;
    const critica = ot.critica ? "Sí" : "No";
    const pendiente = ot.pendiente ? "Sí" : "No";

    if (lineas && lineas.length > 1) {
      // Fila de cabecera del grupo, igual que en el PDF/impresión: acá va la
      // descripción y nota generales de la OT (distintas de las de cada
      // línea/equipo), que si no se agregaran quedarían fuera del Excel.
      filas.push([
        String(idx + 1),
        "PLAN DE TURNO",
        `OT ${otNum(ot)}`,
        "",
        "",
        otNum(ot),
        `${ot.descripcion || "—"}${ot.nota ? `  |  Nota: ${ot.nota}` : ""}`,
        "",
        "PLAN",
        critica,
        pendiente,
      ]);
      lineas.forEach((l: LineaDisplay, li: number) => {
        filas.push([
          `${idx + 1}.${li + 1}`,
          "PLAN DE TURNO",
          `${tipoOtDisplay(l.tipoOT || ot.tipoOT).texto} (PLAN)`,
          l.tag,
          l.hh ? String(l.hh) : "—",
          otNum(ot),
          textoDescripcion(l.descripcion, l.resolucion, l.estadoFinal),
          textoTareas(l.tareasEjecutadas, l.descripcionTrabajo),
          "PLAN",
          critica,
          pendiente,
        ]);
      });
      return;
    }

    const linea0 = lineas?.[0];
    const textoTareasCol = linea0?.tareasEjecutadas && linea0.tareasEjecutadas.length > 0
      ? textoTareas(linea0.tareasEjecutadas, undefined)
      : (ot.nota || linea0?.descripcionTrabajo || "—");

    filas.push([
      String(idx + 1),
      "PLAN DE TURNO",
      `${ot.tipoOT ? tipoOtDisplay(ot.tipoOT).texto : "—"} (${ot.esGuardia ? "OPEPLANT" : "PLAN"})`,
      linea0?.tag || ot.tag || "—",
      String(linea0?.hh || ot.hhTotal || "—"),
      otNum(ot),
      textoDescripcion(ot.descripcion || linea0?.descripcion, linea0?.resolucion, linea0?.estadoFinal),
      textoTareasCol,
      "PLAN",
      critica,
      pendiente,
    ]);
  });

  otsPlanBitacora.forEach((ot, idx) => {
    (ot.bitacora ?? []).forEach((b: BitacoraEntry, bi: number) => {
      filas.push([
        `${otsPlanResto.length + idx + 1}.${bi + 1}`,
        "CMR / CMP REGISTRADOS EN SISTEMA",
        `${tipoOtDisplay(ot.tipoOT || "PDM").texto} (OPEPLANT)`,
        "OPEPLANT",
        b.hhAtendidas ? String(b.hhAtendidas) : "—",
        otNum(ot),
        textoDescripcion(b.nota || ot.descripcion, b.resolucion, b.estadoFinal),
        [b.supervisor, b.turno].filter(Boolean).join(" · ") || "—",
        "EJECUTADA",
        ot.critica ? "Sí" : "No",
        ot.pendiente ? "Sí" : "No",
      ]);
    });
  });

  otsRegistradas.forEach((ot, idx) => {
    const concluida = ["completada", "concluido", "revisado"].includes(ot.estado);
    const lineas = ot.lineas && ot.lineas.length > 0 ? ot.lineas : null;
    const baseIdx = otsPlanResto.length + otsPlanBitacora.length + idx + 1;
    const estadoTxt = concluida ? "EJECUTADA" : "PENDIENTE";
    const critica = ot.critica ? "Sí" : "No";
    const pendiente = ot.pendiente ? "Sí" : "No";

    if (lineas && lineas.length > 1) {
      // Fila de cabecera del grupo, igual que en el PDF/impresión (ver
      // comentario equivalente más arriba en la sección PLAN DE TURNO).
      filas.push([
        String(baseIdx),
        "CMR / CMP REGISTRADOS EN SISTEMA",
        `OT ${otNum(ot)} · Total: ${ot.hhTotal}HH`,
        "",
        "",
        otNum(ot),
        `${ot.descripcion || "—"}${ot.nota ? `  |  Nota: ${ot.nota}` : ""}`,
        "",
        estadoTxt,
        critica,
        pendiente,
      ]);
      lineas.forEach((l: LineaDisplay, li: number) => {
        filas.push([
          `${baseIdx}.${li + 1}`,
          "CMR / CMP REGISTRADOS EN SISTEMA",
          tipoOtDisplay(l.tipoOT).texto,
          l.tag,
          l.hh ? String(l.hh) : "—",
          otNum(ot),
          textoDescripcion(l.descripcion, l.resolucion, l.estadoFinal),
          textoTareas(l.tareasEjecutadas, l.descripcionTrabajo),
          estadoTxt,
          critica,
          pendiente,
        ]);
      });
      return;
    }

    const linea0 = lineas?.[0];
    filas.push([
      String(baseIdx),
      "CMR / CMP REGISTRADOS EN SISTEMA",
      tipoOtDisplay(ot.tipoOT).texto,
      ot.tag,
      String(ot.hhTotal || "—"),
      otNum(ot),
      textoDescripcion(ot.descripcion, linea0?.resolucion, linea0?.estadoFinal),
      textoTareas(linea0?.tareasEjecutadas, linea0?.descripcionTrabajo),
      estadoTxt,
      critica,
      pendiente,
    ]);
  });

  const encabezado: (string | number)[][] = [
    ["REPORTE DE TURNO — TÉCNICO / TURNERO"],
    [],
    ["Gerencia:", "Mantenimiento Planta", "", "Técnico / Turnero:", reporte.tecnicoNombre],
    ["Turno:", reporte.turno, "", "Fecha:", fmtFecha(reporte.fecha)],
    [],
    ["Total OTs:", res.totalOTs, "Completadas:", res.concluidas, "Pasan a sgte. turno:", res.pendientes, "HH Totales:", res.hhTotales, "Correctivos:", res.correctivos, "Preventivos:", res.preventivos],
    [],
  ];

  const cabeceraTabla = ["Item", "Sección", "Tipo", "Equipo Tag", "Hrs", "OT #", "Descripción del trabajo", "Tareas ejecutadas", "Estado", "Crítica", "Pasa a sgte. turno"];
  const filasTabla: FilaOT[] = filas.length > 0
    ? filas
    : [["—", "—", "—", "—", "—", "—", "Sin OTs registradas en este turno.", "—", "—", "—", "—"]];

  const aoa: (string | number)[][] = [...encabezado, cabeceraTabla, ...filasTabla];

  aoa.push([], ["NOVEDADES / ALERTAS PARA EL SIGUIENTE TURNO"]);
  if (reporte.novedades.length > 0) {
    aoa.push(["Nivel", "Tag", "Descripción / Novedad"]);
    reporte.novedades.forEach((n: Novedad) => aoa.push([n.prioridad, n.tag ?? "—", n.descripcion]));
  } else {
    aoa.push(["Sin novedades registradas."]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 8 }, { wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 6 }, { wch: 12 },
    { wch: 45 }, { wch: 35 }, { wch: 14 }, { wch: 8 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reporte de Turno");

  const fechaArchivo = reporte.fecha.slice(0, 10);
  XLSX.writeFile(wb, `Reporte_Turno_Tecnico_${reporte.tecnicoNombre.replace(/\s+/g, "_")}_${fechaArchivo}.xlsx`);
}
