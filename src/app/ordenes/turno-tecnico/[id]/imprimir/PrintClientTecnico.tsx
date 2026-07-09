"use client";
import { useState } from "react";

type BitacoraEntry = { turno: string; supervisor: string; nota: string; resolucion?: string; estadoFinal?: string; hhAtendidas: number; fecha?: string };
type LineaDisplay  = { tag: string; tipoOT: string; descripcion: string; resolucion: string; estadoFinal?: string; hh: number; observaciones?: string; tareasEjecutadas?: string[]; descripcionTrabajo?: string };

// El checklist de tareas (tareasEjecutadas) es opcional y casi nunca se usa;
// el detalle de trabajo real casi siempre queda en descripcionTrabajo (campo
// obligatorio del formulario), así que se usa como respaldo para no dejar
// la columna en blanco.
function TareasEjecutadas({ tareas, fallback }: { tareas?: string[]; fallback?: string }) {
  if (tareas && tareas.length > 0) {
    return (
      <ul style={{ margin: 0, paddingLeft: 14 }}>
        {tareas.map((t, i) => <li key={i} style={{ fontSize: 8 }}>{t}</li>)}
      </ul>
    );
  }
  if (fallback) return <span style={{ fontSize: 9 }}>{fallback}</span>;
  return <span style={{ fontStyle: "italic", color: "#94a3b8" }}>—</span>;
}

const ESTADO_FINAL_LABEL: Record<string, { label: string; color: string }> = {
  operativo:       { label: "Operativo",              color: "#16a34a" },
  operativo_obs:   { label: "Operativo c/ observación", color: "#d97706" },
  pendiente:       { label: "Pendiente",              color: "#2563eb" },
  fuera_servicio:  { label: "Fuera de servicio",      color: "#dc2626" },
};

function EstadoFinalBadge({ estadoFinal }: { estadoFinal?: string }) {
  if (!estadoFinal) return null;
  const e = ESTADO_FINAL_LABEL[estadoFinal];
  if (!e) return null;
  return (
    <span style={{ fontSize: 7, fontWeight: 700, color: e.color, background: e.color + "15", borderRadius: 4, padding: "1px 5px", marginLeft: 5 }}>
      {e.label}
    </span>
  );
}

type OTDisplay = {
  id: string; numeroOT: string; otJdeNumero?: string | null; tag: string; tipoOT: string;
  descripcion: string; tecnicos: string[]; hhTotal: number;
  estado: string; critica: boolean; pendiente: boolean; nota: string;
  esPlan?: boolean; esGuardia?: boolean; bitacora?: BitacoraEntry[];
  lineas?: LineaDisplay[];
};

function otNum(ot: OTDisplay) { return ot.otJdeNumero ?? ot.numeroOT; }

type Novedad = { prioridad: string; tag?: string; descripcion: string };

type ReporteData = {
  _id: string; turno: string; fecha: string; tecnicoNombre: string;
  resumenEjecutivo: {
    totalOTs: number; concluidas: number; pendientes: number;
    hhTotales: number; correctivos: number; preventivos: number;
  };
  novedades: Novedad[];
};

const PRIOR_COLOR: Record<string, string> = {
  URGENTE: "#dc2626", ATENCION: "#d97706", INFORMACION: "#2563eb",
};
const TIPO_COLOR: Record<string, string> = {
  CMP: "#dc2626", CMR: "#d97706", PMP: "#2563eb", PMT: "#0891b2", PTJ: "#7c3aed", PDM: "#7c3aed",
};

export default function PrintClientTecnico({
  reporte, ots,
}: {
  reporte: ReporteData;
  ots: OTDisplay[];
}) {
  const [zoom, setZoom] = useState(100);
  const fecha = new Date(reporte.fecha);
  const fechaStr = fecha.toLocaleDateString("es-BO", { day: "2-digit", month: "long", year: "numeric" });
  const res = reporte.resumenEjecutivo;

  const criticas      = ots.filter(o => o.critica);
  const pendientesSig = ots.filter(o => o.pendiente);

  // Separar OTs del plan y OTs registradas
  // Si una OT del plan ya tiene un registro en sistema con el mismo número, no la mostramos en el plan
  const otsRegistradas = ots.filter(o => !o.esPlan);
  const numerosRegistrados = new Set(otsRegistradas.map(o => o.otJdeNumero ?? o.numeroOT));
  const otsPlan = ots.filter(o => o.esPlan && !numerosRegistrados.has(o.otJdeNumero ?? o.numeroOT));

  // Las OPEPLANT con bitácora se muestran junto a las CMR/CMP registradas
  // (sección verde), no dentro del plan de turno (sección azul) — mismo
  // criterio visual que el reporte original.
  const otsPlanBitacora = otsPlan.filter(o => o.esGuardia && o.bitacora && o.bitacora.length > 0);
  const otsPlanResto = otsPlan.filter(o => !(o.esGuardia && o.bitacora && o.bitacora.length > 0));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Calibri:wght@400;600;700&display=swap');
        @page { size: A4 landscape; margin: 10mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; }
        body { background: white; color: #000; font-size: 10pt; }
        @media screen {
          body { padding: 20px; background: #f0f0f0; }
          .pagina { background: white; width: 277mm; margin: 0 auto 20px; padding: 10mm; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
        }
        @media print { .no-print { display: none !important; } .pagina { page-break-after: always; } .pagina:last-child { page-break-after: avoid; } }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: middle; }
        th { background: #1f3864; color: white; font-weight: bold; text-align: center; font-size: 9pt; }
        .kpis { display: flex; gap: 6px; margin: 6px 0; }
        .kpi { flex: 1; border: 1px solid #000; padding: 4px; text-align: center; }
        .kpi-val { font-size: 14pt; font-weight: bold; }
        .kpi-lbl { font-size: 7pt; color: #555; }
        .section-title { font-weight: bold; font-size: 9pt; background: #e8edf4; padding: 3px 6px; border: 1px solid #000; margin-top: 8px; margin-bottom: 3px; }
        .plan-row td { background: #f8fafc !important; }
        .plan-badge { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 3px; padding: 1px 5px; font-size: 7pt; font-weight: bold; }
        .opeplant-badge { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 3px; padding: 1px 5px; font-size: 7pt; font-weight: bold; }
      `}</style>

      {/* Botones pantalla */}
      <div className="no-print" style={{ position: "fixed", top: 12, right: 12, display: "flex", gap: 8, zIndex: 100 }}>
        <button onClick={async () => {
          try {
            const { default: html2pdf } = await import("html2pdf.js");
            const el = document.querySelector(".pagina") as HTMLElement;
            if (!el) { window.print(); return; }
            html2pdf().set({
              margin: 8, filename: `reporte-turno-${reporte.tecnicoNombre.split(" ")[0]}-${reporte.fecha.slice(0,10)}.pdf`,
              image: { type: "jpeg", quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true },
              jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
            }).from(el).save();
          } catch { window.print(); }
        }}
          style={{ padding: "9px 20px", background: "#16a34a", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          ⬇ Descargar PDF
        </button>
        <button onClick={() => window.print()}
          style={{ padding: "9px 20px", background: "#1f3864", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          🖨 Imprimir
        </button>
        <button onClick={() => window.close()}
          style={{ padding: "9px 14px", background: "#64748b", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
          ✕ Cerrar
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "white", border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 8px" }}>
          <button onClick={() => setZoom(z => Math.max(50, z - 10))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#374151", padding: "0 4px" }}>−</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", minWidth: 38, textAlign: "center" }}>{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(150, z + 10))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#374151", padding: "0 4px" }}>+</button>
        </div>
      </div>

      <div className="pagina" style={{ transform: `scale(${zoom/100})`, transformOrigin: "top center" }}>
        {/* ── ENCABEZADO ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1.5px solid #000", marginBottom: 4 }}>
          <tbody>
            <tr>
              <td style={{ width: 105, borderRight: "1px solid #000", textAlign: "center", padding: "6px 8px", verticalAlign: "middle" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-msc.png" alt="MSC" style={{ height: 46, objectFit: "contain", display: "block", margin: "0 auto" }} />
              </td>
              <td style={{ borderRight: "1px solid #000", textAlign: "center", verticalAlign: "middle", padding: "8px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: "bold", letterSpacing: "0.04em" }}>REPORTE DE TURNO — TÉCNICO / TURNERO</div>
              </td>
              <td style={{ width: 100, padding: 0, verticalAlign: "top" }}>
                <div style={{ textAlign: "center", padding: "6px 6px 4px", fontSize: 8.5, fontWeight: "600", lineHeight: 1.6 }}>
                  <div>2.03.P01.F36</div>
                  <div>Revisión: 1</div>
                </div>
                <div style={{ borderTop: "1px solid #000", background: "#b8b8b8", textAlign: "center", padding: "5px 6px", fontSize: 9, fontWeight: "bold" }}>
                  INTERNA
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── SUBENCABEZADO ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000", marginBottom: 6, fontSize: 8.5 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 7px", borderRight: "1px solid #000", width: "22%" }}><b>Gerencia:</b> Mantenimiento Planta</td>
              <td style={{ padding: "4px 7px", borderRight: "1px solid #000", width: "34%" }}><b>Técnico / Turnero:</b> {reporte.tecnicoNombre}</td>
              <td style={{ padding: "4px 7px", borderRight: "1px solid #000", width: "16%" }}><b>Turno:</b> {reporte.turno}</td>
              <td style={{ padding: "4px 7px", width: "28%" }}><b>Fecha:</b> {fechaStr}</td>
            </tr>
          </tbody>
        </table>

        {/* ── KPIs ── */}
        <div className="kpis">
          {[
            { val: res.totalOTs,     lbl: "Total OTs",      color: "#1f3864" },
            { val: res.concluidas,   lbl: "Completadas",    color: "#16a34a" },
            { val: res.pendientes,   lbl: "Pasan a sgtte",  color: "#d97706" },
            { val: res.hhTotales,    lbl: "HH Totales",     color: "#2563eb" },
            { val: res.correctivos,  lbl: "Correctivos",    color: "#dc2626" },
            { val: res.preventivos,  lbl: "Preventivos",    color: "#0891b2" },
          ].map(k => (
            <div key={k.lbl} className="kpi">
              <div className="kpi-val" style={{ color: k.color }}>{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          ))}
        </div>

        {/* ── TABLA DE OTs ── */}
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>ITEM</th>
              <th style={{ width: 55 }}>TIPO</th>
              <th style={{ width: 80 }}>EQUIPO TAG</th>
              <th style={{ width: 28 }}>HRS</th>
              <th style={{ width: 60 }}>OT #</th>
              <th style={{ width: 375 }}>DESCRIPCIÓN DEL TRABAJO</th>
              <th style={{ width: 285 }}>TAREAS EJECUTADAS</th>
              <th style={{ width: 60, textAlign: "center" as const }}>ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {/* OTs del plan semanal (turnero) */}
            {otsPlanResto.length > 0 && (
              <tr>
                <td colSpan={8} style={{ background: "#dbeafe", fontWeight: "bold", fontSize: 9, padding: "3px 6px", color: "#1e40af" }}>
                  PLAN DE TURNO — {reporte.turno.toUpperCase()} ({otsPlanResto.length} OT{otsPlanResto.length !== 1 ? "s" : ""} · {otsPlanResto.reduce((s,o)=>s+o.hhTotal,0)} HH)
                </td>
              </tr>
            )}
            {otsPlanResto.map((ot, idx) => {
              // OT de plan normal o OPEPLANT sin bitácora
              const planLineas = ot.lineas && ot.lineas.length > 0 ? ot.lineas : null;
              // Si tiene múltiples líneas con resolución, mostrar una sub-fila por línea
              if (planLineas && planLineas.length > 1) {
                const bgPlan = ot.critica ? "#fff1f2" : "#f8fafc";
                return [
                  <tr key={`${ot.id}-phdr`} style={{ background: "#dbeafe" }}>
                    <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold" }}>{idx + 1}</td>
                    <td colSpan={4} style={{ fontSize: 9, fontWeight: "bold", color: "#1e40af" }}>
                      OT {otNum(ot)} · {ot.descripcion || "—"}
                    </td>
                    <td colSpan={2} style={{ fontSize: 9, fontStyle: ot.nota ? "normal" : "italic", color: ot.nota ? "#1e293b" : "#94a3b8" }}>
                      {ot.nota || "—"}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 8.5, fontWeight: "bold" }}>
                      <span style={{ color: "#16a34a", background: "#dcfce7", padding: "2px 5px", borderRadius: 3 }}>PLAN</span>
                    </td>
                  </tr>,
                  ...planLineas.map((l, li) => (
                    <tr key={`${ot.id}-pl${li}`} style={{ background: bgPlan }}>
                      <td style={{ textAlign: "center", fontSize: 8, color: "#94a3b8" }}>{idx + 1}.{li + 1}</td>
                      <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold", color: TIPO_COLOR[l.tipoOT] ?? "#000" }}>
                        {l.tipoOT || ot.tipoOT || "—"}
                        <div style={{ fontSize: 7, marginTop: 1 }}><span className="plan-badge">PLAN</span></div>
                      </td>
                      <td style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: 9 }}>{l.tag}</td>
                      <td style={{ textAlign: "center", fontSize: 9 }}>{l.hh || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 8, color: "#64748b" }}>{otNum(ot)}</td>
                      <td style={{ fontSize: 9 }}>
                        {l.descripcion && <div>{l.descripcion}</div>}
                        {l.resolucion  && <div style={{ color: "#16a34a", fontStyle: "italic" }}>✓ {l.resolucion}<EstadoFinalBadge estadoFinal={l.estadoFinal} /></div>}
                      </td>
                      <td colSpan={2} style={{ fontSize: 8, color: "#475569" }}><TareasEjecutadas tareas={l.tareasEjecutadas} fallback={l.descripcionTrabajo} /></td>
                    </tr>
                  )),
                ];
              }
              // Una sola línea o sin lineas
              return (
                <tr key={ot.id} className="plan-row" style={{ background: ot.critica ? "#fff1f2" : ot.esGuardia ? "#fffbeb" : "#f8fafc" }}>
                  <td style={{ textAlign: "center", fontSize: 9 }}>{idx + 1}</td>
                  <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold", color: TIPO_COLOR[ot.tipoOT] ?? "#000" }}>
                    {ot.tipoOT || "—"}
                    <div style={{ fontSize: 7, marginTop: 1 }}>
                      <span className={ot.esGuardia ? "opeplant-badge" : "plan-badge"}>{ot.esGuardia ? "OPEPLANT" : "PLAN"}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: 9 }}>{planLineas?.[0]?.tag || ot.tag || "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 9 }}>{planLineas?.[0]?.hh || ot.hhTotal || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 9 }}>{otNum(ot)}</td>
                  <td style={{ fontSize: 9 }}>
                    {ot.descripcion || planLineas?.[0]?.descripcion || "—"}
                    {planLineas?.[0]?.resolucion && <div style={{ color: "#16a34a", fontStyle: "italic", fontSize: 8 }}>✓ {planLineas[0].resolucion}<EstadoFinalBadge estadoFinal={planLineas[0].estadoFinal} /></div>}
                  </td>
                  <td style={{ fontSize: 8, color: "#475569" }}>
                    {planLineas?.[0]?.tareasEjecutadas && planLineas[0].tareasEjecutadas.length > 0
                      ? <TareasEjecutadas tareas={planLineas[0].tareasEjecutadas} />
                      : (() => {
                          const texto = ot.nota || planLineas?.[0]?.descripcionTrabajo || "";
                          return <span style={{ fontStyle: texto ? "normal" : "italic", color: texto ? "#1e293b" : "#94a3b8", fontSize: 9 }}>{texto || "—"}</span>;
                        })()}
                    {ot.critica   && <div style={{ fontSize: 8, color: "#dc2626", fontWeight: "bold" }}>⚠ CRÍTICA</div>}
                    {ot.pendiente && <div style={{ fontSize: 8, color: "#d97706", fontWeight: "bold" }}>→ SGTE TURNO</div>}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 8.5, fontWeight: "bold" }}>
                    <span style={{ color: "#16a34a", background: "#dcfce7", padding: "2px 5px", borderRadius: 3 }}>PLAN</span>
                  </td>
                </tr>
              );
            })}

            {/* OTs OPEPLANT (bitácora) + OTs registradas (CMR/CMP del sistema) */}
            {(otsPlanBitacora.length > 0 || otsRegistradas.length > 0) && (
              <tr>
                <td colSpan={8} style={{ background: "#f0fdf4", fontWeight: "bold", fontSize: 9, padding: "3px 6px", color: "#166534" }}>
                  CMR / CMP REGISTRADOS EN SISTEMA ({otsPlanBitacora.length + otsRegistradas.length} OT{(otsPlanBitacora.length + otsRegistradas.length) !== 1 ? "s" : ""})
                </td>
              </tr>
            )}
            {otsPlanBitacora.map((ot, idx) => {
              const entradas = ot.bitacora ?? [];
              return entradas.map((b, bi) => (
                <tr key={`${ot.id}-b${bi}`} className="plan-row" style={{ background: "#fffbeb" }}>
                  <td style={{ textAlign: "center", fontSize: 9 }}>{otsPlanResto.length + idx + 1}.{bi + 1}</td>
                  <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold", color: TIPO_COLOR[ot.tipoOT] ?? "#d97706" }}>
                    {ot.tipoOT || "PDM"}
                    <div style={{ fontSize: 7, marginTop: 1 }}><span className="opeplant-badge">OPEPLANT</span></div>
                  </td>
                  <td style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: 9 }}>OPEPLANT</td>
                  <td style={{ textAlign: "center", fontSize: 9 }}>{b.hhAtendidas || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 9 }}>{otNum(ot)}</td>
                  <td style={{ fontSize: 9 }}>
                    {b.nota || ot.descripcion || "—"}
                    {b.resolucion && <div style={{ color: "#16a34a", fontStyle: "italic", fontSize: 8, marginTop: 2 }}>✓ {b.resolucion}<EstadoFinalBadge estadoFinal={b.estadoFinal} /></div>}
                  </td>
                  <td style={{ fontSize: 9, color: "#92400e" }}>
                    {b.supervisor && <span>{b.supervisor}</span>}
                    {b.turno && <span style={{ color: "#64748b" }}> · {b.turno}</span>}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 8.5, fontWeight: "bold" }}>
                    <span style={{ color: "#92400e", background: "#fef3c7", padding: "2px 5px", borderRadius: 3 }}>EJECUTADA</span>
                  </td>
                </tr>
              ));
            })}
            {otsRegistradas.map((ot, idx) => {
              const concluida = ["completada","concluido","revisado"].includes(ot.estado);
              const lineas = ot.lineas && ot.lineas.length > 0 ? ot.lineas : null;
              const baseIdx = otsPlanResto.length + otsPlanBitacora.length + idx + 1;
              const bgRow = ot.critica ? "#fff1f2" : concluida ? "#f0fdf4" : "white";
              const estadoBadge = concluida
                ? <span style={{ color: "#16a34a", background: "#dcfce7", padding: "2px 5px", borderRadius: 3 }}>EJECUTADA</span>
                : <span style={{ color: "#92400e", background: "#fef3c7", padding: "2px 5px", borderRadius: 3 }}>PENDIENTE</span>;

              if (lineas && lineas.length > 1) {
                return [
                  <tr key={`${ot.id}-hdr`} style={{ background: "#e8f0fe" }}>
                    <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold" }}>{baseIdx}</td>
                    <td colSpan={4} style={{ fontSize: 9, fontWeight: "bold", color: "#1e40af" }}>
                      OT {otNum(ot)} · Total: {ot.hhTotal}HH
                    </td>
                    <td colSpan={2} style={{ fontSize: 9, fontStyle: ot.nota ? "normal" : "italic", color: ot.nota ? "#1e293b" : "#94a3b8" }}>
                      {ot.nota || "—"}
                      {ot.critica   && <span style={{ fontSize: 8, color: "#dc2626", fontWeight: "bold" }}> ⚠ CRÍTICA</span>}
                      {ot.pendiente && <span style={{ fontSize: 8, color: "#d97706", fontWeight: "bold" }}> → SGTE TURNO</span>}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 8.5 }}>{estadoBadge}</td>
                  </tr>,
                  ...lineas.map((l, li) => (
                    <tr key={`${ot.id}-l${li}`} style={{ background: bgRow }}>
                      <td style={{ textAlign: "center", fontSize: 8, color: "#94a3b8" }}>{baseIdx}.{li + 1}</td>
                      <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold", color: TIPO_COLOR[l.tipoOT] ?? "#000" }}>{l.tipoOT}</td>
                      <td style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: 9 }}>{l.tag}</td>
                      <td style={{ textAlign: "center", fontSize: 9 }}>{l.hh || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 8, color: "#64748b" }}>{otNum(ot)}</td>
                      <td style={{ fontSize: 9 }}>
                        {l.descripcion && <div>{l.descripcion}</div>}
                        {l.resolucion  && <div style={{ color: "#16a34a", fontStyle: "italic" }}>✓ {l.resolucion}<EstadoFinalBadge estadoFinal={l.estadoFinal} /></div>}
                      </td>
                      <td colSpan={2} style={{ fontSize: 8, color: "#475569" }}>
                        <TareasEjecutadas tareas={l.tareasEjecutadas} fallback={l.descripcionTrabajo} />
                      </td>
                    </tr>
                  )),
                ];
              }

              // OT con una sola línea — fila simple
              return (
                <tr key={ot.id} style={{ background: bgRow }}>
                  <td style={{ textAlign: "center", fontSize: 9 }}>{baseIdx}</td>
                  <td style={{ textAlign: "center", fontSize: 9, fontWeight: "bold", color: TIPO_COLOR[ot.tipoOT] ?? "#000" }}>{ot.tipoOT}</td>
                  <td style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: 9 }}>{ot.tag}</td>
                  <td style={{ textAlign: "center", fontSize: 9 }}>{ot.hhTotal || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 9 }}>{otNum(ot)}</td>
                  <td style={{ fontSize: 9 }}>
                    {ot.descripcion}
                    {lineas?.[0]?.resolucion && <div style={{ color: "#16a34a", fontStyle: "italic", fontSize: 8 }}>✓ {lineas[0].resolucion}<EstadoFinalBadge estadoFinal={lineas[0].estadoFinal} /></div>}
                  </td>
                  <td style={{ fontSize: 8, color: "#475569" }}>
                    <TareasEjecutadas tareas={lineas?.[0]?.tareasEjecutadas} fallback={lineas?.[0]?.descripcionTrabajo} />
                    {ot.critica   && <div style={{ fontSize: 8, color: "#dc2626", fontWeight: "bold" }}>⚠ CRÍTICA</div>}
                    {ot.pendiente && <div style={{ fontSize: 8, color: "#d97706", fontWeight: "bold" }}>→ SGTE TURNO</div>}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 8.5, fontWeight: "bold" }}>{estadoBadge}</td>
                </tr>
              );
            })}

            {ots.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "#888", fontStyle: "italic", padding: "8px" }}>Sin OTs registradas en este turno.</td></tr>
            )}
          </tbody>
        </table>

        {/* ── NOVEDADES ── */}
        <div className="section-title">NOVEDADES / ALERTAS PARA EL SIGUIENTE TURNO</div>
        {reporte.novedades.length === 0 ? (
          <table><tbody><tr><td style={{ fontSize: 8, color: "#888", fontStyle: "italic", padding: "6px 8px" }}>Sin novedades registradas.</td></tr></tbody></table>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>NIVEL</th>
                <th style={{ width: 80 }}>TAG</th>
                <th>DESCRIPCIÓN / NOVEDAD</th>
              </tr>
            </thead>
            <tbody>
              {reporte.novedades.map((n, i) => (
                <tr key={i}>
                  <td style={{ color: PRIOR_COLOR[n.prioridad] ?? "#000", fontWeight: "bold", textAlign: "center", fontSize: 8 }}>{n.prioridad}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 8 }}>{n.tag ?? "—"}</td>
                  <td style={{ fontSize: 8 }}>{n.descripcion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── OTs CRÍTICAS / PENDIENTES ── */}
        {(criticas.length > 0 || pendientesSig.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
            {criticas.length > 0 && (
              <div>
                <div className="section-title" style={{ color: "#dc2626" }}>⚠ OTs CRÍTICAS ({criticas.length})</div>
                {criticas.map(o => (
                  <div key={o.id} style={{ fontSize: 8, padding: "2px 6px", borderBottom: "1px solid #eee" }}>
                    <b>{otNum(o)}</b> — {o.tag} — {o.descripcion}
                  </div>
                ))}
              </div>
            )}
            {pendientesSig.length > 0 && (
              <div>
                <div className="section-title" style={{ color: "#d97706" }}>→ PENDIENTES SIGUIENTE TURNO ({pendientesSig.length})</div>
                {pendientesSig.map(o => (
                  <div key={o.id} style={{ fontSize: 8, padding: "2px 6px", borderBottom: "1px solid #eee" }}>
                    <b>{otNum(o)}</b> — {o.tag} — {o.descripcion}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 7, color: "#888", textAlign: "center" }}>
          Reporte generado por Sync MSC — Sistema de Gestión de Mantenimiento Planta
        </div>
      </div>
    </>
  );
}
