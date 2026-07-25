"use client";

import React, { useState, useRef, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import { tipoOtDisplay } from "@/lib/tiposOt";

// ─── Types ───────────────────────────────────────────────────────────────────

type Linea = {
  tag: string;
  descripcionEquipo: string;
  tipoOT: string;
  disciplina?: string;
  categoriaISO?: string;
  sintoma?: string;
  causaProbable?: string;
  resolucionAplicada?: string;
  descripcionTrabajo?: string;
  tareasEjecutadas?: string[];
  tiempoEstimadoHrs?: number;
  tiempoRealHrs?: number;
  observaciones?: string;
};

type OT = {
  _id: string;
  numeroOT: string;
  fecha: string;
  turno: string;
  areaCodigo: string;
  tecnicos: { usuarioId: string; nombreCompleto: string }[];
  lineas: Linea[];
  estado: string;
  datosSupervision?: {
    clasificacionRCM?: string;
    codigoModoFallaISO?: string;
    comentariosSupervisor?: string;
  };
};

type Equipo = {
  _id: string;
  tag: string;
  descripcion: string;
  descripcion2?: string;
  descripcion3?: string;
  nivel?: number;
  parentTag?: string;
  nivelPath?: string[];
  tipoEquipo: string;
  descripcionTipo?: string;
  subtipo?: string;
  descripcionSubtipo?: string;
  categoriaISO?: string;
  criticidad?: string;
  centroCosto?: string;
  areaCodigo: string;
  descripcionArea?: string;
  fabricante?: string;
  modelo?: string;
  serie?: string;
  fechaInstalacion?: string;
  vidaUtilEstimadaAnos?: number;
  activo?: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

function tipoColor(tipoOT: string): string {
  return tipoOtDisplay(tipoOT).color.color;
}

// PDM=Predictivo real; PTJ (proyecto/ingeniería) se agrupa con Correctivo,
// igual que en el resto de la app (familia "C" de src/lib/tiposOt.ts).
const TIPO_GRUPO: Record<string, string> = {
  CMP: "Correctivo", CMR: "Correctivo", PTJ: "Correctivo",
  PMP: "Preventivo", PMT: "Preventivo",
  PDM: "Predictivo",
};

const CRITICIDAD_COLOR: Record<string, string> = { A: "#dc2626", B: "#d97706", C: "#16a34a" };
const CRITICIDAD_LABEL: Record<string, string> = {
  A: "A — Crítico sin respaldo", B: "B — Importante con alternativa", C: "C — Menor",
};

const S = {
  page: { minHeight: "100vh", background: "#f1f5f9" },
  wrap: { maxWidth: 900, margin: "0 auto", padding: "20px 16px 56px" },
  card: {
    background: "white", borderRadius: 12, border: "1px solid #e2e8f0",
    padding: "18px 16px", marginBottom: 12,
  },
  label: {
    display: "block" as const, fontSize: 11, fontWeight: 700, color: "#64748b",
    letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 4,
  },
  input: {
    border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 13px",
    fontSize: 14, color: "#1e293b", outline: "none",
    boxSizing: "border-box" as const, background: "white",
  },
  badge: (color: string) => ({
    display: "inline-block" as const, background: color + "18", color,
    border: `1px solid ${color}40`, borderRadius: 5, padding: "2px 8px",
    fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
  }),
  btnPrimary: {
    background: "#0f2847", color: "white", border: "none", borderRadius: 8,
    padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const,
  },
  btnGhost: {
    background: "transparent", color: "#64748b", border: "1px solid #e2e8f0",
    borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcMetrics(ots: OT[], tag: string) {
  const lineas = ots.flatMap((ot) => ot.lineas.filter((l) => l.tag === tag).map((l) => ({ ...l, ot })));
  const total = lineas.length;
  const correctivas = lineas.filter((l) => ["CMP", "CMR"].includes(l.tipoOT)).length;
  const preventivas = lineas.filter((l) => ["PMP", "PMT"].includes(l.tipoOT)).length;
  const predictivas = lineas.filter((l) => l.tipoOT === "PTJ").length;
  const horasTotal = lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
  const mttr = correctivas > 0
    ? lineas.filter((l) => ["CMP", "CMR"].includes(l.tipoOT)).reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0) / correctivas
    : 0;

  // MTBF: average hours between failures (simplified using OT dates sorted)
  const corrDates = ots
    .filter((o) => o.lineas.some((l) => l.tag === tag && ["CMP", "CMR"].includes(l.tipoOT)))
    .map((o) => new Date(o.fecha).getTime())
    .sort((a, b) => a - b);
  let mtbf = 0;
  if (corrDates.length >= 2) {
    const diffs = corrDates.slice(1).map((d, i) => (d - corrDates[i]) / 3_600_000);
    mtbf = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  }

  // Modo de falla más frecuente
  const modos: Record<string, number> = {};
  ots.forEach((o) => {
    const ds = o.datosSupervision;
    if (ds?.codigoModoFallaISO && o.lineas.some((l) => l.tag === tag)) {
      modos[ds.codigoModoFallaISO] = (modos[ds.codigoModoFallaISO] ?? 0) + 1;
    }
  });
  const modoTop = Object.entries(modos).sort((a, b) => b[1] - a[1])[0];

  return { total, correctivas, preventivas, predictivas, horasTotal, mttr, mtbf, modoTop };
}

// Detecta causas que se repiten (componente recurrente)
function detectarRecurrencia(ots: OT[], tag: string): { causa: string; veces: number }[] {
  const freq: Record<string, number> = {};
  for (const ot of ots) {
    for (const l of ot.lineas) {
      if (l.tag !== tag || !l.causaProbable) continue;
      const key = l.causaProbable.toLowerCase().trim().slice(0, 60);
      freq[key] = (freq[key] ?? 0) + 1;
    }
  }
  return Object.entries(freq)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([causa, veces]) => ({ causa, veces }));
}

// Exportar historial del TAG a CSV
function exportarCSV(ots: OT[], tag: string, equipo: Equipo | null) {
  const rows: string[] = [
    "OT,Fecha,Turno,TipoOT,Disciplina,Sintoma,Causa,Resolucion,HsEstimadas,HsReales,Tecnicos,Estado"
  ];
  for (const ot of ots) {
    const l = ot.lineas.find(x => x.tag === tag);
    if (!l) continue;
    const cols = [
      ot.numeroOT, new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" }),
      ot.turno, l.tipoOT, l.disciplina ?? "",
      l.sintoma ?? l.descripcionTrabajo ?? "",
      l.causaProbable ?? "", l.resolucionAplicada ?? "",
      String(l.tiempoEstimadoHrs ?? ""), String(l.tiempoRealHrs ?? ""),
      ot.tecnicos.map(t => t.nombreCompleto).join("; "), ot.estado,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
    rows.push(cols.join(","));
  }
  const csv = "﻿" + rows.join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `historial_${equipo?.tag ?? tag}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReporteTAGPage() {
  const [tagInput, setTagInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [ots, setOts] = useState<OT[]>([]);
  const [searchedTag, setSearchedTag] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Autocomplete
  const [sugerencias, setSugerencias] = useState<{ tag: string; descripcion: string; tipoEquipo: string }[]>([]);
  const [showSug, setShowSug] = useState(false);
  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filtros
  const [filtroTipo, setFiltroTipo] = useState<string[]>([]);
  const [filtroDisc, setFiltroDisc] = useState<string[]>([]);
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  const toggleDisc = useCallback((d: string) => {
    setFiltroDisc(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }, []);

  function onTagChange(val: string) {
    const v = val.toUpperCase();
    setTagInput(v);
    if (sugTimer.current) clearTimeout(sugTimer.current);
    if (v.length < 2) { setSugerencias([]); setShowSug(false); return; }
    sugTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/equipos?q=${encodeURIComponent(v)}&limit=8`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setSugerencias(data.map((e: Equipo & { descripcionTipo?: string }) => ({
            tag: e.tag, descripcion: e.descripcion, tipoEquipo: e.tipoEquipo ?? "",
          })));
          setShowSug(true);
        } else {
          setSugerencias([]); setShowSug(false);
        }
      } catch { setSugerencias([]); setShowSug(false); }
    }, 220);
  }

  function seleccionarSugerencia(tag: string) {
    setTagInput(tag);
    setSugerencias([]);
    setShowSug(false);
    buscar(tag);
  }

  async function buscar(tagBuscado?: string) {
    const t = (tagBuscado ?? tagInput).trim().toUpperCase();
    if (!t) return;
    setSearching(true);
    setNotFound(false);
    setFetchError("");
    setEquipo(null);
    setOts([]);
    setSearchedTag(t);
    setExpanded(new Set());
    try {
      const [eqRes, otRes] = await Promise.all([
        fetch(`/api/equipos?tag=${encodeURIComponent(t)}&all=true`).then(async (r) => {
          const text = await r.text();
          try { return JSON.parse(text); } catch { throw new Error(`Equipos: ${text.slice(0, 80)}`); }
        }),
        fetch(`/api/ordenes?tag=${encodeURIComponent(t)}&limit=200`).then(async (r) => {
          const text = await r.text();
          try { return JSON.parse(text); } catch { throw new Error(`Ordenes: ${text.slice(0, 80)}`); }
        }),
      ]);
      const eq: Equipo | null = Array.isArray(eqRes) && eqRes.length > 0 ? eqRes[0] : null;
      const otList: OT[] = Array.isArray(otRes) ? otRes : [];
      if (!eq && otList.length === 0) setNotFound(true);
      setEquipo(eq);
      setOts(otList);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : "Error desconocido");
    }
    finally { setSearching(false); }
  }

  // Filtrar OTs por tipo, disciplina y fecha
  const otsFiltradas = ots.filter((o) => {
    const linea = o.lineas.find((l) => l.tag === searchedTag);
    if (!linea) return false;
    if (filtroTipo.length > 0 && !filtroTipo.includes(TIPO_GRUPO[linea.tipoOT] ?? "")) return false;
    if (filtroDisc.length > 0 && !filtroDisc.includes(linea.disciplina ?? "")) return false;
    const f = new Date(o.fecha);
    if (filtroDesde && f < new Date(filtroDesde)) return false;
    if (filtroHasta && f > new Date(filtroHasta + "T23:59:59")) return false;
    return true;
  });

  const recurrencias = searchedTag ? detectarRecurrencia(otsFiltradas, searchedTag) : [];

  const metrics = searchedTag ? calcMetrics(otsFiltradas, searchedTag) : null;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleTipo(g: string) {
    setFiltroTipo((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <AppHeader backHref="/ordenes" />
      <div style={S.wrap}>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 4 }}>
            Historial de Intervenciones por TAG
          </h1>
          <p style={{ fontSize: 12, color: "#94a3b8" }}>§2.7 — Historial ISO 14224 por equipo</p>
        </div>

        {/* Buscador */}
        <div style={{ ...S.card, marginBottom: 16 }}>
          <label style={S.label}>TAG del Equipo</label>
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                ref={inputRef}
                value={tagInput}
                onChange={(e) => onTagChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { setShowSug(false); buscar(); }
                  if (e.key === "Escape") setShowSug(false);
                }}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
                onFocus={() => sugerencias.length > 0 && setShowSug(true)}
                placeholder="Ej: PIT-320067, MOT-620011…"
                style={{ ...S.input, width: "100%" }}
                autoComplete="off"
              />
              {showSug && sugerencias.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
                  background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.10)", marginTop: 4, overflow: "hidden",
                }}>
                  {sugerencias.map((s) => (
                    <button key={s.tag} onMouseDown={() => seleccionarSugerencia(s.tag)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "9px 14px", background: "none", border: "none",
                        cursor: "pointer", textAlign: "left", borderBottom: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", minWidth: 110 }}>{s.tag}</span>
                      <span style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.descripcion}
                      </span>
                      {s.tipoEquipo && (
                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto", whiteSpace: "nowrap" }}>{s.tipoEquipo}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { setShowSug(false); buscar(); }} disabled={searching || !tagInput.trim()} style={{ ...S.btnPrimary, opacity: (searching || !tagInput.trim()) ? 0.6 : 1 }}>
              {searching ? "Buscando…" : "Buscar"}
            </button>
          </div>
        </div>

        {notFound && (
          <div style={{ ...S.card, textAlign: "center", padding: "32px 20px" }}>
            <p style={{ color: "#94a3b8", fontSize: 14 }}>No se encontraron registros para el TAG <strong>{searchedTag}</strong>.</p>
            <p style={{ color: "#cbd5e1", fontSize: 12, marginTop: 4 }}>Verifique que el TAG existe y que hay OTs registradas.</p>
          </div>
        )}

        {(equipo || ots.length > 0) && (
          <>
            {/* ── Datos Maestros del Equipo ── */}
            <div style={{ ...S.card, padding: "12px 14px" }}>
              {equipo ? (() => {
                // Fila label+valor en línea horizontal compacta
                const R = ({ label, value, mono, badge }: { label: string; value?: string | number | null; mono?: boolean; badge?: React.ReactNode }) => {
                  if (!badge && (value == null || value === "")) return null;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "4px 0", borderBottom: "1px solid #f8fafc" }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
                      {badge ?? <span style={{ fontSize: 12, color: "#1e293b", fontFamily: mono ? "monospace" : undefined, textAlign: "right", wordBreak: "break-all" }}>{String(value)}</span>}
                    </div>
                  );
                };
                const Sep = ({ title }: { title: string }) => (
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#cbd5e1", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginTop: 8, marginBottom: 2 }}>{title}</div>
                );
                return (
                  <div>
                    {/* Header compacto */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#0f2847", fontFamily: "monospace" }}>{equipo.tag}</span>
                      {equipo.criticidad && (
                        <span style={S.badge(CRITICIDAD_COLOR[equipo.criticidad] ?? "#64748b")}>
                          {equipo.criticidad} — {["A","B","C"].includes(equipo.criticidad) ? ["Crítico","Importante","Menor"][["A","B","C"].indexOf(equipo.criticidad)] : equipo.criticidad}
                        </span>
                      )}
                      {equipo.nivel != null && <span style={{ fontSize: 10, color: "#94a3b8" }}>Nv{equipo.nivel}</span>}
                    </div>
                    <p style={{ fontSize: 12, color: "#334155", marginBottom: 8, lineHeight: 1.4 }}>{equipo.descripcion}{equipo.descripcion2 ? ` / ${equipo.descripcion2}` : ""}</p>

                    <Sep title="Clasificación" />
                    <R label="Tipo JDE" value={equipo.tipoEquipo} mono />
                    <R label="Desc. Tipo" value={equipo.descripcionTipo} />
                    <R label="Subtipo" value={equipo.subtipo ? `${equipo.subtipo}${equipo.descripcionSubtipo ? ` — ${equipo.descripcionSubtipo}` : ""}` : null} />
                    <R label="ISO 14224" value={equipo.categoriaISO} />

                    <Sep title="Ubicación" />
                    <R label="Área" value={`${equipo.areaCodigo}${equipo.descripcionArea ? ` — ${equipo.descripcionArea}` : ""}`} />
                    <R label="C. Costo" value={equipo.centroCosto} mono />
                    <R label="TAG Padre" value={equipo.parentTag} mono />
                    {equipo.nivelPath && equipo.nivelPath.length > 1 && (
                      <R label="Ruta" value={equipo.nivelPath.join(" › ")} mono />
                    )}

                    {(equipo.fabricante || equipo.modelo || equipo.serie || equipo.fechaInstalacion || equipo.vidaUtilEstimadaAnos) && (<>
                      <Sep title="Placa de datos" />
                      <R label="Fabricante" value={equipo.fabricante} />
                      <R label="Modelo" value={equipo.modelo} />
                      <R label="Serie" value={equipo.serie} mono />
                      <R label="Instalación" value={equipo.fechaInstalacion ? new Date(equipo.fechaInstalacion).toLocaleDateString("es-BO") : null} />
                      <R label="Vida útil" value={equipo.vidaUtilEstimadaAnos ? `${equipo.vidaUtilEstimadaAnos} años` : null} />
                    </>)}
                  </div>
                );
              })() : (
                <div style={{ background: "#fffbeb", borderRadius: 8, padding: "8px 12px", border: "1px solid #fde68a" }}>
                  <p style={{ fontSize: 12, color: "#92400e" }}>
                    ⚠ TAG <strong>{searchedTag}</strong> no está en el catálogo. Se muestran las OTs encontradas.
                  </p>
                </div>
              )}
            </div>

            {/* ── Filtros ── */}
            <div style={S.card}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#64748b", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>
                Filtros de Búsqueda
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
                <div>
                  <label style={S.label}>Desde</label>
                  <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} style={{ ...S.input, width: "100%" }} />
                </div>
                <div>
                  <label style={S.label}>Hasta</label>
                  <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} style={{ ...S.input, width: "100%" }} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={S.label}>Tipo de OT</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                  {["Correctivo", "Preventivo", "Predictivo"].map((g) => (
                    <button key={g} onClick={() => toggleTipo(g)}
                      style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: filtroTipo.includes(g) ? "2px solid #0f2847" : "1px solid #e2e8f0",
                        background: filtroTipo.includes(g) ? "#0f2847" : "white",
                        color: filtroTipo.includes(g) ? "white" : "#64748b" }}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={S.label}>Disciplina</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                  {[
                    { key: "Mecanico", label: "⚙️ Mecánico", color: "#0891b2" },
                    { key: "Electrico", label: "⚡ Eléctrico", color: "#d97706" },
                    { key: "Instrumentacion", label: "📡 Instrumentación", color: "#7c3aed" },
                  ].map(({ key, label, color }) => (
                    <button key={key} onClick={() => toggleDisc(key)}
                      style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: filtroDisc.includes(key) ? `2px solid ${color}` : "1px solid #e2e8f0",
                        background: filtroDisc.includes(key) ? color + "15" : "white",
                        color: filtroDisc.includes(key) ? color : "#64748b" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "space-between", alignItems: "center" }}>
                {(filtroTipo.length > 0 || filtroDisc.length > 0 || filtroDesde || filtroHasta) && (
                  <button onClick={() => { setFiltroTipo([]); setFiltroDisc([]); setFiltroDesde(""); setFiltroHasta(""); }}
                    style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12 }}>
                    Limpiar filtros
                  </button>
                )}
                {otsFiltradas.length > 0 && (
                  <button onClick={() => exportarCSV(otsFiltradas, searchedTag, equipo)}
                    style={{ ...S.btnGhost, padding: "5px 14px", fontSize: 12, color: "#16a34a", borderColor: "#86efac", marginLeft: "auto" }}>
                    ↓ Exportar CSV ({otsFiltradas.length} OTs)
                  </button>
                )}
              </div>
            </div>

            {/* ── Resumen Ejecutivo ── */}
            {metrics && (
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 14 }}>
                  Resumen de Confiabilidad
                  {(filtroDesde || filtroHasta) && (
                    <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400, marginLeft: 8 }}>
                      ({filtroDesde || "inicio"} – {filtroHasta || "hoy"})
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
                  {[
                    { label: "Total Intervenciones", value: String(metrics.total), color: "#0f2847" },
                    { label: "Correctivas", value: `${metrics.correctivas} (${metrics.total ? Math.round(metrics.correctivas / metrics.total * 100) : 0}%)`, color: "#dc2626" },
                    { label: "Preventivas", value: `${metrics.preventivas} (${metrics.total ? Math.round(metrics.preventivas / metrics.total * 100) : 0}%)`, color: "#2563eb" },
                    { label: "Predictivas", value: `${metrics.predictivas} (${metrics.total ? Math.round(metrics.predictivas / metrics.total * 100) : 0}%)`, color: "#7c3aed" },
                    { label: "Horas Fuera de Servicio", value: `${metrics.horasTotal.toFixed(1)} hrs`, color: "#0f2847" },
                    { label: "MTTR Promedio", value: metrics.mttr > 0 ? `${metrics.mttr.toFixed(1)} hrs` : "—", color: "#d97706" },
                  ].map((m) => (
                    <div key={m.label} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 14px", border: "1px solid #f1f5f9" }}>
                      <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>{m.label}</p>
                      <p style={{ fontSize: 18, fontWeight: 800, color: m.color }}>{m.value}</p>
                    </div>
                  ))}
                </div>

                {metrics.mtbf > 0 && (
                  <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 14px", marginBottom: 10 }}>
                    <p style={{ fontSize: 12, color: "#0369a1" }}>
                      <strong>MTBF estimado:</strong> {metrics.mtbf.toFixed(0)} hrs ({(metrics.mtbf / 24).toFixed(1)} días) entre fallas correctivas
                    </p>
                  </div>
                )}

                {metrics.modoTop && (
                  <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8, padding: "10px 14px", marginBottom: 10 }}>
                    <p style={{ fontSize: 12, color: "#713f12" }}>
                      <strong>Modo de Falla más frecuente:</strong> {metrics.modoTop[0]} ({metrics.modoTop[1]} eventos)
                    </p>
                  </div>
                )}

                {(metrics.correctivas >= 2 || recurrencias.length > 0) && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px" }}>
                    <p style={{ fontSize: 12, color: "#991b1b", fontWeight: 700, marginBottom: recurrencias.length > 0 ? 6 : 0 }}>
                      ⚠ ALERTA: {metrics.correctivas} fallas correctivas — evaluar causa raíz sistémica (ISO 14224 §RCA).
                    </p>
                    {recurrencias.map((r, i) => (
                      <p key={i} style={{ fontSize: 12, color: "#b91c1c", marginTop: 3 }}>
                        🔁 Causa repetida {r.veces}×: <em>&quot;{r.causa}&quot;</em>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Cronología (línea de tiempo simple) ── */}
            {otsFiltradas.length > 0 && (
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 14 }}>
                  Cronología de Intervenciones
                </div>
                <div style={{ position: "relative", paddingLeft: 28 }}>
                  <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: "#e2e8f0" }} />
                  {[...otsFiltradas]
                    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
                    .map((ot) => {
                      const linea = ot.lineas.find((l) => l.tag === searchedTag)!;
                      const color = tipoColor(linea.tipoOT);
                      return (
                        <div key={ot._id} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                          <div style={{
                            position: "absolute", left: 5, width: 12, height: 12, borderRadius: "50%",
                            background: color, border: "2px solid white", boxShadow: `0 0 0 2px ${color}`,
                            marginTop: 3,
                          }} />
                          <div style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "8px 12px", border: `1px solid ${color}25` }}>
                            <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 2 }}>
                              <span style={{ fontWeight: 700, fontSize: 12, color: "#0f2847" }}>
                                {new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })}
                              </span>
                              <span style={S.badge(color)}>{tipoOtDisplay(linea.tipoOT).texto}</span>
                              <span style={{ fontSize: 11, color: "#94a3b8" }}>OT #{ot.numeroOT}</span>
                            </div>
                            <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.4 }}>
                              {linea.sintoma || linea.descripcionTrabajo || "—"}
                            </p>
                            {linea.tiempoRealHrs && (
                              <span style={{ fontSize: 11, color: "#16a34a" }}>{linea.tiempoRealHrs}h</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ── Detalle de Intervenciones ── */}
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 10 }}>
              Detalle de Intervenciones ({otsFiltradas.length})
            </div>

            {otsFiltradas.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: "28px 20px" }}>
                <p style={{ color: "#94a3b8", fontSize: 13 }}>No hay intervenciones con los filtros seleccionados.</p>
              </div>
            ) : (
              [...otsFiltradas]
                .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
                .map((ot, idx) => {
                  const linea = ot.lineas.find((l) => l.tag === searchedTag)!;
                  const color = tipoColor(linea.tipoOT);
                  const isOpen = expanded.has(ot._id);
                  const isCorrectivo = ["CMP", "CMR"].includes(linea.tipoOT);
                  const ds = ot.datosSupervision;

                  return (
                    <div key={ot._id} style={{ ...S.card, border: `1px solid ${color}30`, borderLeft: `4px solid ${color}` }}>
                      {/* Encabezado de la intervención */}
                      <button
                        onClick={() => toggleExpand(ot._id)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: "#64748b" }}>#{idx + 1}</span>
                            <span style={{ fontWeight: 800, fontSize: 14, color: "#0f2847" }}>OT #{ot.numeroOT}</span>
                            <span style={S.badge(color)}>{linea.tipoOT}</span>
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>
                              {new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })} · {ot.turno}
                            </span>
                            {linea.tiempoRealHrs && (
                              <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>{linea.tiempoRealHrs}h</span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: "#475569" }}>
                            {linea.sintoma || linea.descripcionTrabajo || "—"}
                          </p>
                        </div>
                        <span style={{ fontSize: 18, color: "#94a3b8", marginLeft: 12 }}>{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {/* Detalle expandible */}
                      {isOpen && (
                        <div style={{ marginTop: 14, borderTop: `1px solid ${color}20`, paddingTop: 14 }}>

                          {/* ISO 14224 — 5 Preguntas del Historial */}
                          {(linea.sintoma || linea.causaProbable || linea.resolucionAplicada || linea.tiempoRealHrs || linea.descripcionTrabajo) && (
                            <div style={{ background: isCorrectivo ? "#fff7ed" : "#f0f9ff", border: `1px solid ${isCorrectivo ? "#fed7aa" : "#bae6fd"}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                              <p style={{ fontSize: 10, fontWeight: 700, color: isCorrectivo ? "#c2410c" : "#0369a1", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 10 }}>
                                Registro ISO 14224 — Historial Técnico
                              </p>
                              <div style={{ display: "grid", gap: 6 }}>
                                {[
                                  { q: "¿Qué falló?",       v: linea.sintoma,            color: "#7c2d12" },
                                  { q: "¿Cómo falló?",      v: ds?.codigoModoFallaISO,   color: "#7c2d12" },
                                  { q: "¿Por qué falló?",   v: linea.causaProbable,       color: "#7c2d12" },
                                  { q: "¿Qué se hizo?",     v: linea.resolucionAplicada ?? (linea.tareasEjecutadas?.join("; ")), color: "#065f46" },
                                  { q: "¿Cuánto impactó?",  v: linea.tiempoRealHrs ? `${linea.tiempoRealHrs} hrs fuera de servicio` : undefined, color: "#1e40af" },
                                ].map(({ q, v, color }) => v ? (
                                  <div key={q} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", minWidth: 100, paddingTop: 1 }}>{q}</span>
                                    <span style={{ fontSize: 12, color, lineHeight: 1.4 }}>{v}</span>
                                  </div>
                                ) : null)}
                              </div>
                            </div>
                          )}

                          {/* Tareas ejecutadas (preventivos/predictivos) */}
                          {!isCorrectivo && linea.tareasEjecutadas && linea.tareasEjecutadas.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <p style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 }}>
                                Tareas Ejecutadas
                              </p>
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {linea.tareasEjecutadas.map((t, i) => (
                                  <li key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 2 }}>{t}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Datos de Supervisión */}
                          {ds && (ds.clasificacionRCM || ds.codigoModoFallaISO || ds.comentariosSupervisor) && (
                            <div style={{ background: "#f0fdfa", border: "1px solid #a7f3d0", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                              <p style={{ fontSize: 11, fontWeight: 700, color: "#065f46", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
                                Datos de Supervisión
                              </p>
                              {ds.clasificacionRCM && (
                                <p style={{ fontSize: 12, color: "#065f46", marginBottom: 4 }}>
                                  <strong>Tipo Actividad (RCM):</strong> {ds.clasificacionRCM}
                                </p>
                              )}
                              {ds.codigoModoFallaISO && (
                                <p style={{ fontSize: 12, color: "#065f46", marginBottom: 4 }}>
                                  <strong>Modo de Falla (ISO 14224):</strong> {ds.codigoModoFallaISO}
                                </p>
                              )}
                              {ds.comentariosSupervisor && (
                                <p style={{ fontSize: 12, color: "#065f46" }}>
                                  <strong>Comentarios:</strong> {ds.comentariosSupervisor}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Observaciones */}
                          {linea.observaciones && (
                            <div style={{ marginBottom: 12 }}>
                              <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>
                                Observaciones
                              </p>
                              <p style={{ fontSize: 12, color: "#475569", fontStyle: "italic" }}>{linea.observaciones}</p>
                            </div>
                          )}

                          {/* Técnico(s) */}
                          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" as const }}>
                            <div>
                              <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 2 }}>
                                Técnico(s)
                              </p>
                              <p style={{ fontSize: 12, color: "#374151" }}>{ot.tecnicos.map((t) => t.nombreCompleto).join(", ")}</p>
                            </div>
                            {(linea.tiempoEstimadoHrs || linea.tiempoRealHrs) && (
                              <div>
                                <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 2 }}>
                                  Tiempos
                                </p>
                                <p style={{ fontSize: 12 }}>
                                  {linea.tiempoEstimadoHrs && <span style={{ color: "#94a3b8" }}>Est: {linea.tiempoEstimadoHrs}h </span>}
                                  {linea.tiempoRealHrs && <span style={{ color: "#16a34a", fontWeight: 600 }}>Real: {linea.tiempoRealHrs}h</span>}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Botón Ver OT */}
                          <div style={{ marginTop: 12 }}>
                            <a
                              href="/ordenes/reporte"
                              style={{ display: "inline-block", background: "#f1f5f9", color: "#374151", border: "1px solid #e2e8f0", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
                            >
                              Ver OT completa →
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </>
        )}

        {/* Estado vacío inicial */}
        {!searchedTag && !searching && (
          <div style={{ ...S.card, textAlign: "center", padding: "48px 20px" }}>
            <p style={{ fontSize: 36, marginBottom: 12 }}>🔍</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Ingrese un TAG para consultar el historial</p>
            <p style={{ fontSize: 12, color: "#94a3b8" }}>Se mostrarán los datos maestros del equipo, métricas de confiabilidad y todas las OTs registradas.</p>
          </div>
        )}

      </div>
    </div>
  );
}
