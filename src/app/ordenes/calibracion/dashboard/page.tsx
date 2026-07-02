"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";

type Registro = {
  _id: string;
  numeroCertificado: string;
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  patronCodigo: string;
  tecnicoNombre: string;
  fecha: string;
  resultadoGeneral: "APROBADO" | "RECHAZADO" | "AJUSTADO";
  puntos: { aprueba: boolean }[];
  puntosAntes?: { aprueba: boolean }[];
  createdAt?: string;
};

type Patron = {
  _id: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  fechaVencimiento: string;
  activo: boolean;
};

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function diasRestantes(fechaStr: string) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaStr);
  fecha.setHours(0, 0, 0, 0);
  return Math.floor((fecha.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}

const RESULTADO_COLOR: Record<string, string> = {
  APROBADO: "#16a34a",
  RECHAZADO: "#dc2626",
  AJUSTADO: "#d97706",
};

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "white",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      padding: "16px 20px",
      borderLeft: `4px solid ${color ?? "#0f2847"}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color ?? "#0f2847", lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function DashboardCalibracionPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [patrones, setPatrones] = useState<Patron[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/calibracion?limit=200").then(r => r.json()),
      fetch("/api/patrones?all=true").then(r => r.json()),
    ])
      .then(([regs, pats]) => {
        setRegistros(Array.isArray(regs) ? regs : []);
        setPatrones(Array.isArray(pats) ? pats : []);
      })
      .finally(() => setLoading(false));
  }, []);

  // ── KPI calculations ──────────────────────────────────────────────────────
  const now = new Date();
  const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const esteMes = registros.filter(r => r.fecha?.slice(0, 7) === mesActual);
  const totalEsteMes = esteMes.length;
  const aprobadosEsteMes = esteMes.filter(r => r.resultadoGeneral === "APROBADO" || r.resultadoGeneral === "AJUSTADO").length;
  const pctConforme = totalEsteMes > 0 ? Math.round((aprobadosEsteMes / totalEsteMes) * 100) : 0;
  const rechazadosAntes = registros.filter(r => r.puntosAntes && r.puntosAntes.some(p => !p.aprueba)).length;
  const pctNoConforme = registros.length > 0 ? Math.round((rechazadosAntes / registros.length) * 100) : 0;

  // Patrones vencidos
  const patronesVencidos = patrones.filter(p => diasRestantes(p.fechaVencimiento) < 0);
  const patronesProximos7 = patrones.filter(p => {
    const d = diasRestantes(p.fechaVencimiento);
    return d >= 0 && d <= 30;
  });

  // ── TAG analysis: último registro por TAG ─────────────────────────────────
  const ultimoPorTag: Record<string, Registro> = {};
  for (const r of registros) {
    if (!ultimoPorTag[r.tag] || new Date(r.fecha) > new Date(ultimoPorTag[r.tag].fecha)) {
      ultimoPorTag[r.tag] = r;
    }
  }
  const tagsSinCalibracionReciente = Object.values(ultimoPorTag)
    .filter(r => diasRestantes(r.fecha) < -180)
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
    .slice(0, 10);

  // ── Monthly trend (last 6 months) ─────────────────────────────────────────
  const meses: { label: string; key: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("es-BO", { month: "short", year: "2-digit" });
    meses.push({ label, key });
  }
  const maxMes = Math.max(1, ...meses.map(m => registros.filter(r => r.fecha?.slice(0, 7) === m.key).length));

  // ── Recent 10 ─────────────────────────────────────────────────────────────
  const recientes = [...registros]
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .slice(0, 10);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
        <AppHeader backHref="/ordenes/calibracion" />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <div style={{ color: "#64748b" }}>Cargando dashboard...</div>
        </div>
      </div>
    );
  }

  const S = {
    card: { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", marginBottom: 16 },
    th: { padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, textAlign: "left" as const, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" },
    td: { padding: "10px 12px", fontSize: 13, color: "#1e293b", borderBottom: "1px solid #f1f5f9" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/ordenes/calibracion" />

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 40px" }}>

        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847", margin: 0 }}>
              Dashboard de Calibraciones
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
              Área 3320 — Instrumentación · {registros.length} registros totales
            </p>
          </div>
          <Link
            href="/ordenes/calibracion"
            style={{
              background: "#0f2847",
              color: "white",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 13,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            + Nueva calibración
          </Link>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          <KpiCard label="Calibraciones este mes" value={totalEsteMes} sub={`de ${registros.length} total`} color="#0f2847" />
          <KpiCard label="% Conformes (mes)" value={`${pctConforme}%`} sub={`${aprobadosEsteMes} aprobados/ajustados`} color="#16a34a" />
          <KpiCard label="Con no conformidad antes" value={`${pctNoConforme}%`} sub={`${rechazadosAntes} registros`} color="#d97706" />
          <KpiCard label="Patrones vencidos" value={patronesVencidos.length} sub="requieren recalibración" color={patronesVencidos.length > 0 ? "#dc2626" : "#16a34a"} />
          <KpiCard label="Patrones próx. 30 días" value={patronesProximos7.length} sub="vencen pronto" color={patronesProximos7.length > 0 ? "#d97706" : "#16a34a"} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Monthly trend */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
              Tendencia Mensual (últimos 6 meses)
            </h3>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80 }}>
              {meses.map(m => {
                const count = registros.filter(r => r.fecha?.slice(0, 7) === m.key).length;
                const height = Math.round((count / maxMes) * 68) + 4;
                const isCurrent = m.key === mesActual;
                return (
                  <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#0f2847" }}>{count}</div>
                    <div style={{
                      width: "100%",
                      height,
                      background: isCurrent ? "#0f2847" : "#bfdbfe",
                      borderRadius: "3px 3px 0 0",
                      transition: "height 0.3s",
                    }} />
                    <div style={{ fontSize: 9, color: isCurrent ? "#0f2847" : "#94a3b8", fontWeight: isCurrent ? 700 : 400 }}>
                      {m.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Result breakdown */}
          <div style={S.card}>
            <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
              Resultado General (total)
            </h3>
            {(["APROBADO", "AJUSTADO", "RECHAZADO"] as const).map(res => {
              const count = registros.filter(r => r.resultadoGeneral === res).length;
              const pct = registros.length > 0 ? Math.round((count / registros.length) * 100) : 0;
              const col = RESULTADO_COLOR[res];
              return (
                <div key={res} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: col }}>{res}</span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 4, transition: "width 0.5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Patrones vencidos */}
        {patronesVencidos.length > 0 && (
          <div style={{ ...S.card, borderLeft: "4px solid #dc2626" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#dc2626" }}>
              ⚠ Patrones Vencidos ({patronesVencidos.length})
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Código", "Descripción", "Tipo", "Vencimiento", "Días vencido"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patronesVencidos.map(p => {
                    const dias = Math.abs(diasRestantes(p.fechaVencimiento));
                    return (
                      <tr key={p._id}>
                        <td style={{ ...S.td, fontWeight: 700, color: "#0f2847" }}>{p.codigo}</td>
                        <td style={S.td}>{p.descripcion}</td>
                        <td style={S.td}>{p.tipo}</td>
                        <td style={{ ...S.td, color: "#dc2626", fontWeight: 600 }}>{fmtDate(p.fechaVencimiento)}</td>
                        <td style={{ ...S.td, color: "#dc2626", fontWeight: 700 }}>{dias} días</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Patrones próximos a vencer */}
        {patronesProximos7.length > 0 && (
          <div style={{ ...S.card, borderLeft: "4px solid #d97706" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#d97706" }}>
              ⏰ Patrones Próximos a Vencer — 30 días ({patronesProximos7.length})
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Código", "Descripción", "Tipo", "Vencimiento", "Días restantes"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patronesProximos7.sort((a, b) => diasRestantes(a.fechaVencimiento) - diasRestantes(b.fechaVencimiento)).map(p => {
                    const dias = diasRestantes(p.fechaVencimiento);
                    return (
                      <tr key={p._id}>
                        <td style={{ ...S.td, fontWeight: 700, color: "#0f2847" }}>{p.codigo}</td>
                        <td style={S.td}>{p.descripcion}</td>
                        <td style={S.td}>{p.tipo}</td>
                        <td style={{ ...S.td, color: "#d97706", fontWeight: 600 }}>{fmtDate(p.fechaVencimiento)}</td>
                        <td style={{ ...S.td, color: dias <= 7 ? "#dc2626" : "#d97706", fontWeight: 700 }}>{dias} días</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAGs sin calibración reciente */}
        {tagsSinCalibracionReciente.length > 0 && (
          <div style={S.card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
              TAGs sin Calibración Reciente (+180 días)
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["TAG", "Instrumento", "Tipo Variable", "Última Calibración", "Días sin calibrar", "Último resultado"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tagsSinCalibracionReciente.map(r => {
                    const dias = Math.abs(diasRestantes(r.fecha));
                    return (
                      <tr key={r._id}>
                        <td style={{ ...S.td, fontWeight: 700, color: "#0f2847" }}>{r.tag}</td>
                        <td style={S.td}>{r.descripcionInstrumento}</td>
                        <td style={S.td}>{r.tipoVariable}</td>
                        <td style={S.td}>{fmtDate(r.fecha)}</td>
                        <td style={{ ...S.td, color: dias > 365 ? "#dc2626" : "#d97706", fontWeight: 700 }}>{dias} días</td>
                        <td style={S.td}>
                          <span style={{ color: RESULTADO_COLOR[r.resultadoGeneral], fontWeight: 700, fontSize: 12 }}>
                            {r.resultadoGeneral}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent calibrations */}
        <div style={S.card}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
            Últimas 10 Calibraciones
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["N° Cert", "TAG", "Tipo Variable", "Patrón", "Técnico", "Fecha", "Resultado", ""].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recientes.map(r => (
                  <tr key={r._id}>
                    <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.numeroCertificado}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: "#0f2847" }}>{r.tag}</td>
                    <td style={S.td}>{r.tipoVariable}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{r.patronCodigo}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{r.tecnicoNombre.split(" ").slice(0, 2).join(" ")}</td>
                    <td style={S.td}>{fmtDate(r.fecha)}</td>
                    <td style={S.td}>
                      <span style={{
                        color: RESULTADO_COLOR[r.resultadoGeneral] ?? "#64748b",
                        fontWeight: 700,
                        fontSize: 12,
                      }}>
                        {r.resultadoGeneral}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      <Link
                        href={`/ordenes/calibracion/${r._id}/certificado`}
                        style={{ fontSize: 11, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                      >
                        PDF
                      </Link>
                    </td>
                  </tr>
                ))}
                {recientes.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...S.td, textAlign: "center", color: "#94a3b8", padding: "24px" }}>
                      No hay registros de calibración aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}
