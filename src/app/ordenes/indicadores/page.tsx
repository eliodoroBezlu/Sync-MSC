"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { SEMAFORO_COLOR, Semaforo } from "@/lib/kpiConfig";
import { semanaActualBolivia, getSemanaAnioOffset } from "@/lib/semana";

type Area = { codigo: string; nombre: string };

type Detalle = {
  semana: number; anio: number;
  fechaInicio: string; fechaFin: string;
  cumplimiento: { planeadas: number; realizadas: number; pct: number | null; semaforo: Semaforo | null };
  reactivo: { reactivoHH: number; totalHH: number; pct: number | null; semaforo: Semaforo | null };
  utilizacion: { areaCodigo: string; areaNombre: string; hhReal: number; hhDisponible: number | null; pct: number | null }[];
  pareto: { tag: string; descripcionEquipo: string; cantidad: number; hhTotal: number }[];
  totalCorrectivas: number;
  tendencia: { semana: number; anio: number; label: string; cumplimientoPct: number | null; reactivoPct: number | null }[];
  alcance: { allAreas: boolean; areas?: string[] };
};

const S = {
  page: { minHeight: "100vh", background: "#f1f5f9" },
  wrap: { maxWidth: 900, margin: "0 auto", padding: "20px 16px 56px" },
  card: { background: "white", borderRadius: 14, border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 800, color: "#0f2847", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: "0.05em" },
};

function pillColor(s: Semaforo | null): string {
  return s ? SEMAFORO_COLOR[s] : "#94a3b8";
}

function fmtPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)}%`;
}

function BigStat({ label, value, semaforo, detail }: { label: string; value: string; semaforo: Semaforo | null; detail: string }) {
  return (
    <div style={{ flex: "1 1 220px", minWidth: 220 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: pillColor(semaforo), fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{detail}</div>
    </div>
  );
}

function TendenciaChart({ puntos, campo }: { puntos: Detalle["tendencia"]; campo: "cumplimientoPct" | "reactivoPct" }) {
  const max = 100;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90 }}>
      {puntos.map((p) => {
        const val = p[campo];
        const h = val === null ? 2 : Math.max(4, (val / max) * 80);
        const color = campo === "cumplimientoPct"
          ? (val !== null && val >= 90 ? "#16a34a" : val !== null && val >= 75 ? "#d97706" : "#dc2626")
          : (val !== null && val <= 10 ? "#16a34a" : val !== null && val <= 25 ? "#d97706" : "#dc2626");
        return (
          <div key={`${p.anio}-${p.semana}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
            <div style={{ fontSize: 10, color: "#64748b" }}>{val === null ? "—" : `${Math.round(val)}%`}</div>
            <div style={{ width: "100%", maxWidth: 26, height: h, background: val === null ? "#e2e8f0" : color, borderRadius: 4 }} />
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{p.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function IndicadoresPage() {
  const { user } = useUser();
  const inicioActual = semanaActualBolivia();
  const [semana, setSemana] = useState(inicioActual.semana);
  const [anio, setAnio] = useState(inicioActual.anio);
  const [areaFiltro, setAreaFiltro] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [data, setData] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch("/api/areas").then((r) => r.json()).then(setAreas).catch(() => {}); }, []);

  const cargar = useCallback((controller: AbortController) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ semana: String(semana), anio: String(anio) });
    if (areaFiltro) params.set("area", areaFiltro);
    fetch(`/api/ordenes/kpi/detalle?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setData(json.data);
        else setError(json.error ?? "No se pudo cargar");
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError("No se pudo cargar");
      })
      .finally(() => setLoading(false));
  }, [semana, anio, areaFiltro]);

  useEffect(() => {
    const controller = new AbortController();
    cargar(controller);
    return () => controller.abort();
  }, [cargar]);

  function moverSemana(delta: number) {
    const { semana: s, anio: a } = getSemanaAnioOffset(semana, anio, delta);
    setSemana(s);
    setAnio(a);
  }

  const areasVisibles = user?.rol === 3 && user.areas?.length > 0
    ? areas.filter((a) => user.areas.includes(a.codigo))
    : areas;

  return (
    <div style={S.page}>
      <AppHeader backHref="/ordenes" />
      <div style={S.wrap}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847" }}>Indicadores de Mantenimiento</h1>
            <p style={{ color: "#64748b", fontSize: 13 }}>Cumplimiento del programa, reactivo y correctivas no programadas</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "4px 6px" }}>
            <button type="button" onClick={() => moverSemana(-1)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, padding: "2px 8px", color: "#0f2847" }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f2847", minWidth: 90, textAlign: "center" }}>Semana {semana} · {anio}</span>
            <button type="button" onClick={() => moverSemana(1)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, padding: "2px 8px", color: "#0f2847" }}>›</button>
          </div>
          {areasVisibles.length > 1 && (
            <select
              value={areaFiltro}
              onChange={(e) => setAreaFiltro(e.target.value)}
              style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", fontSize: 13, background: "white" }}
            >
              <option value="">Todas las áreas</option>
              {areasVisibles.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
            </select>
          )}
        </div>

        {loading && <div style={{ ...S.card, textAlign: "center", color: "#94a3b8" }}>Cargando…</div>}
        {error && !loading && <div style={{ ...S.card, textAlign: "center", color: "#dc2626" }}>{error}</div>}

        {!loading && !error && data && (
          <>
            <div style={S.card}>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <BigStat
                  label="Cumplimiento del Programa"
                  value={fmtPct(data.cumplimiento.pct)}
                  semaforo={data.cumplimiento.semaforo}
                  detail={`${data.cumplimiento.realizadas} de ${data.cumplimiento.planeadas} OT programadas`}
                />
                <BigStat
                  label="HH Reactivo / No Programado"
                  value={fmtPct(data.reactivo.pct)}
                  semaforo={data.reactivo.semaforo}
                  detail={`${data.reactivo.reactivoHH.toFixed(0)} de ${data.reactivo.totalHH.toFixed(0)} HH`}
                />
                <BigStat
                  label="Correctivas no programadas"
                  value={String(data.totalCorrectivas)}
                  semaforo={null}
                  detail="Líneas CMP/CMR sin plan"
                />
              </div>
            </div>

            <div style={S.card}>
              <div style={S.sectionTitle}>Tendencia — Cumplimiento</div>
              <TendenciaChart puntos={data.tendencia} campo="cumplimientoPct" />
              <div style={{ ...S.sectionTitle, marginTop: 18 }}>Tendencia — % Reactivo</div>
              <TendenciaChart puntos={data.tendencia} campo="reactivoPct" />
            </div>

            <div style={S.card}>
              <div style={S.sectionTitle}>Utilización de HH por Área</div>
              {data.utilizacion.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13 }}>Sin datos en el período.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.utilizacion.map((u) => {
                    const pct = u.pct;
                    const barPct = pct === null ? 0 : Math.min(100, pct);
                    const color = pct === null ? "#94a3b8" : pct >= 90 ? "#16a34a" : pct >= 75 ? "#d97706" : "#dc2626";
                    return (
                      <div key={u.areaCodigo}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, color: "#0f172a" }}>{u.areaCodigo} — {u.areaNombre}</span>
                          <span style={{ color: "#64748b" }}>
                            {u.hhReal.toFixed(0)} HH{u.hhDisponible !== null ? ` / ${u.hhDisponible.toFixed(0)} HH (${fmtPct(pct)})` : ""}
                          </span>
                        </div>
                        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${u.hhDisponible !== null ? barPct : 100}%`, background: color, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={S.card}>
              <div style={S.sectionTitle}>Pareto — Correctivas No Programadas (CMP/CMR)</div>
              {data.pareto.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13 }}>Sin correctivas no programadas en el período.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "6px 8px" }}>Tag</th>
                        <th style={{ padding: "6px 8px" }}>Equipo</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Ocurrencias</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>HH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pareto.map((row) => (
                        <tr key={row.tag} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 700, color: "#0f172a" }}>{row.tag}</td>
                          <td style={{ padding: "6px 8px", color: "#475569" }}>{row.descripcionEquipo || "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.cantidad}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.hhTotal.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
