"use client";

type OTDisplay = {
  id: string; numeroOT: string; tag: string; disciplina: string;
  tipoOT: string; descripcion: string; tecnicos: string[];
  hhTotal: number; estado: string; critica: boolean; pendiente: boolean;
  nota: string; heredada: boolean; pasarNocheMotivo?: string;
};

type Recomendacion = { prioridad: string; area?: string; tag?: string; descripcion: string };

type ReporteData = {
  _id: string; turno: string; fecha: string; supervisorNombre: string; estado: string;
  resumenEjecutivo: {
    totalOTs: number; concluidas: number; pendientes: number;
    inconclusas: number; hhTotales: number; hhCorrectivo: number; hhPreventivo: number;
  };
  recomendaciones: Recomendacion[];
};

const PRIOR_COLOR: Record<string, string> = {
  URGENTE: "#dc2626", PLANIFICAR: "#2563eb", SEGUIMIENTO: "#16a34a", SEGURIDAD: "#d97706",
};

const ESTADO_LABEL: Record<string, string> = {
  no_iniciada: "Sin iniciar", en_proceso: "En proceso", en_revision: "En revisión",
  completada: "Completada", concluido: "Concluido", revisado: "Revisado",
  pendiente: "Pendiente", atrasada: "Atrasada", bloqueada: "Bloqueada",
  borrador: "Borrador",
};

export default function PrintClient({
  reporte, porDisciplina, discNombre, todasOTs,
}: {
  reporte: ReporteData;
  porDisciplina: Record<string, OTDisplay[]>;
  discNombre: Record<string, string>;
  todasOTs: OTDisplay[];
}) {
  const fecha = new Date(reporte.fecha);
  const fechaStr = fecha.toLocaleDateString("es-BO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
  const res = reporte.resumenEjecutivo;

  const criticas = todasOTs.filter(o => o.critica);
  const pendientesSig = todasOTs.filter(o => o.pendiente);

  let item = 0;
  const disciplinasConOTs = Object.entries(porDisciplina).filter(([, ots]) => ots.length > 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Calibri:wght@400;600;700&display=swap');
        @page { size: A4 landscape; margin: 10mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; }
        body { background: white; color: #000; font-size: 9pt; }
        .no-print { display: none !important; }
        @media screen {
          body { padding: 20px; background: #f0f0f0; }
          .pagina { background: white; width: 277mm; margin: 0 auto 20px; padding: 10mm; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
        }
        @media print {
          .pagina { page-break-after: always; }
          .pagina:last-child { page-break-after: avoid; }
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: middle; }
        th { background: #1f3864; color: white; font-weight: bold; text-align: center; font-size: 8pt; }
        .header-main { border: 2px solid #000; margin-bottom: 4px; }
        .header-logo { display: flex; align-items: center; justify-content: center; padding: 6px; border-right: 1px solid #000; }
        .header-title { flex: 1; text-align: center; padding: 6px; border-right: 1px solid #000; }
        .header-code { padding: 4px 8px; font-size: 8pt; min-width: 90px; }
        .subheader td { font-size: 8pt; padding: 3px 6px; }
        .subheader td:first-child { font-weight: bold; }
        .kpis { display: flex; gap: 6px; margin: 6px 0; }
        .kpi { flex: 1; border: 1px solid #000; padding: 4px; text-align: center; }
        .kpi-val { font-size: 14pt; font-weight: bold; }
        .kpi-lbl { font-size: 7pt; color: #555; }
        .disc-header { background: #1f3864 !important; color: white !important; font-weight: bold; font-size: 9pt; padding: 4px 8px !important; }
        .critica-row { background: #fff1f2 !important; }
        .pendiente-badge { background: #d97706; color: white; border-radius: 3px; padding: 1px 4px; font-size: 7pt; font-weight: bold; }
        .critica-badge { background: #dc2626; color: white; border-radius: 3px; padding: 1px 4px; font-size: 7pt; font-weight: bold; }
        .heredada-badge { background: #7c3aed; color: white; border-radius: 3px; padding: 1px 4px; font-size: 7pt; font-weight: bold; }
        .comentarios { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #000; margin-top: 8px; }
        .comentario-box { border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px; min-height: 40px; }
        .comentario-box:nth-child(2n) { border-right: none; }
        .comentario-box:nth-last-child(-n+2) { border-bottom: none; }
        .section-title { font-weight: bold; font-size: 9pt; background: #e8edf4; padding: 3px 6px; border: 1px solid #000; margin-top: 8px; }
        .rec-row td { font-size: 8pt; }
      `}</style>

      {/* Botones de pantalla */}
      <div className="no-print" style={{ position: "fixed", top: 12, right: 12, display: "flex", gap: 8, zIndex: 100 }}>
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#475569", maxWidth: 260 }}>
          Para guardar como PDF: presiona <b>Ctrl+P</b> → destino <b>&quot;Guardar como PDF&quot;</b>
        </div>
        <button onClick={() => window.print()}
          style={{ padding: "9px 20px", background: "#1f3864", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          🖨 Ctrl+P / Guardar PDF
        </button>
        <button onClick={() => window.history.back()}
          style={{ padding: "9px 14px", background: "#64748b", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
          ← Volver
        </button>
      </div>

      <div className="pagina">
        {/* ── ENCABEZADO ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1.5px solid #000", marginBottom: 4 }}>
          <tbody>
            <tr>
              {/* Logo */}
              <td style={{ width: 105, borderRight: "1px solid #000", textAlign: "center", padding: "6px 8px", verticalAlign: "middle" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-msc.png" alt="MSC" style={{ height: 46, objectFit: "contain", display: "block", margin: "0 auto" }} />
              </td>
              {/* Título centrado */}
              <td style={{ borderRight: "1px solid #000", textAlign: "center", verticalAlign: "middle", padding: "8px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: "bold", letterSpacing: "0.04em" }}>REPORTE DE TURNO MANTENIMIENTO PLANTA</div>
              </td>
              {/* Código — dos sub-filas separadas por borde */}
              <td style={{ width: 100, padding: 0, verticalAlign: "top" }}>
                <div style={{ textAlign: "center", padding: "6px 6px 4px", fontSize: 8.5, fontWeight: "600", lineHeight: 1.6 }}>
                  <div>2.03.P01.F35</div>
                  <div>Revisión: 5</div>
                </div>
                <div style={{ borderTop: "1px solid #000", background: "#b8b8b8", textAlign: "center", padding: "5px 6px", fontSize: 9, fontWeight: "bold", letterSpacing: "0.06em" }}>
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
              <td style={{ padding: "4px 7px", borderRight: "1px solid #000", width: "26%" }}><b>Gerencia:</b> Mantenimiento Planta</td>
              <td style={{ padding: "4px 7px", borderRight: "1px solid #000", width: "30%" }}><b>Supervisor de turno:</b> {reporte.supervisorNombre}</td>
              <td style={{ padding: "4px 7px", borderRight: "1px solid #000", width: "18%" }}><b>Turno:</b> {reporte.turno}</td>
              <td style={{ padding: "4px 7px", width: "26%" }}><b>Fecha:</b> {fechaStr}</td>
            </tr>
          </tbody>
        </table>

        {/* ── KPIs ── */}
        <div className="kpis">
          {[
            { val: res.totalOTs, lbl: "Total OTs", color: "#1f3864" },
            { val: res.concluidas, lbl: "Completadas", color: "#16a34a" },
            { val: res.pendientes + res.inconclusas, lbl: "Pendientes", color: "#d97706" },
            { val: res.hhTotales, lbl: "HH Totales", color: "#2563eb" },
            { val: res.hhCorrectivo, lbl: "HH Correctivo", color: "#dc2626" },
            { val: res.hhPreventivo, lbl: "HH Preventivo", color: "#0891b2" },
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
              <th style={{ width: 80 }}>EQUIPO TAG</th>
              <th style={{ width: 70 }}>DISCIPLINA</th>
              <th style={{ width: 28 }}>HRS</th>
              <th style={{ width: 55 }}>OT (JDE)</th>
              <th>DESCRIPCIÓN DEL TRABAJO</th>
              <th style={{ width: 160 }}>NOTA DEL SUPERVISOR</th>
              <th style={{ width: 50, textAlign: "center" as const }}>ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(porDisciplina).filter(([, ots]) => ots.length > 0).map(([disc, ots]) => [
              <tr key={`h-${disc}`}>
                <td colSpan={8} className="disc-header">
                  {discNombre[disc] ?? disc} — {ots.length} OT{ots.length !== 1 ? "s" : ""} · {ots.reduce((s, o) => s + o.hhTotal, 0)} HH
                </td>
              </tr>,
              ...ots.map(ot => {
                item++;
                const concluida = ot.estado === "completada" || ot.estado === "concluido" || ot.estado === "revisado";
                return (
                  <tr key={ot.id} style={{ background: ot.critica ? "#fff1f2" : concluida ? "#f0fdf4" : "white" }}>
                    <td style={{ textAlign: "center", fontSize: 8 }}>{item}</td>
                    <td style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: 8 }}>
                      {ot.tag}
                      {ot.heredada && <div style={{ fontSize: 7, color: "#7c3aed", fontWeight: "bold", marginTop: 1 }}>↓ Noche</div>}
                    </td>
                    <td style={{ fontSize: 8 }}>{discNombre[disc] ?? disc}</td>
                    <td style={{ textAlign: "center", fontSize: 8 }}>{ot.hhTotal || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 8 }}>{ot.numeroOT}</td>
                    <td style={{ fontSize: 8 }}>{ot.descripcion}</td>
                    <td style={{ fontSize: 8, fontStyle: ot.nota ? "normal" : "italic", color: ot.nota ? "#1e293b" : "#94a3b8" }}>
                      {ot.nota || "—"}
                      {ot.critica && <div style={{ fontSize: 7, color: "#dc2626", fontWeight: "bold", marginTop: 1 }}>⚠ CRÍTICA</div>}
                      {ot.pendiente && <div style={{ fontSize: 7, color: "#d97706", fontWeight: "bold", marginTop: 1 }}>→ PASA AL SIGUIENTE TURNO</div>}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 7.5, fontWeight: "bold" }}>
                      {concluida
                        ? <span style={{ color: "#16a34a", background: "#dcfce7", padding: "2px 5px", borderRadius: 3 }}>EJECUTADA</span>
                        : ot.estado === "en_proceso"
                          ? <span style={{ color: "#1d4ed8", background: "#dbeafe", padding: "2px 5px", borderRadius: 3 }}>EN CURSO</span>
                          : <span style={{ color: "#92400e", background: "#fef3c7", padding: "2px 5px", borderRadius: 3 }}>PENDIENTE</span>
                      }
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>

        {/* ── RECOMENDACIONES ── */}
        <div className="section-title">RECOMENDACIONES PARA EL SIGUIENTE TURNO</div>
        {reporte.recomendaciones.length === 0 ? (
          <table><tbody><tr><td style={{ fontSize: 8, color: "#888", fontStyle: "italic", padding: "6px 8px" }}>Sin recomendaciones registradas.</td></tr></tbody></table>
        ) : (
          <table className="rec-row">
            <thead>
              <tr>
                <th style={{ width: 75 }}>PRIORIDAD</th>
                <th style={{ width: 100 }}>ÁREA</th>
                <th style={{ width: 80 }}>TAG</th>
                <th>DESCRIPCIÓN / RECOMENDACIÓN</th>
              </tr>
            </thead>
            <tbody>
              {reporte.recomendaciones.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: PRIOR_COLOR[r.prioridad] ?? "#000", fontWeight: "bold", textAlign: "center", fontSize: 8 }}>{r.prioridad}</td>
                  <td style={{ fontSize: 8 }}>{r.area ?? "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 8 }}>{r.tag ?? "—"}</td>
                  <td style={{ fontSize: 8 }}>{r.descripcion}</td>
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
                    <b>{o.numeroOT}</b> — {o.tag} — {o.descripcion}
                    {o.nota && <span style={{ color: "#64748b" }}> · {o.nota}</span>}
                  </div>
                ))}
              </div>
            )}
            {pendientesSig.length > 0 && (
              <div>
                <div className="section-title" style={{ color: "#d97706" }}>→ PENDIENTES SIGUIENTE TURNO ({pendientesSig.length})</div>
                {pendientesSig.map(o => (
                  <div key={o.id} style={{ fontSize: 8, padding: "2px 6px", borderBottom: "1px solid #eee" }}>
                    <b>{o.numeroOT}</b> — {o.tag} — {o.descripcion}
                    {o.nota && <span style={{ color: "#64748b" }}> · {o.nota}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* espacio al pie */}
        <div style={{ marginTop: 10, fontSize: 7, color: "#888", textAlign: "center" }}>
          Reporte generado por Sync MSC — Sistema de Gestión de Mantenimiento Planta
        </div>

      </div>
    </>
  );
}
