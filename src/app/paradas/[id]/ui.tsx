"use client";

import { ESTADO_OT_META, NARANJA } from "./tipos";

// Helpers de presentación compartidos por las pestañas de la parada.

export function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  const norm = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) + "T12:00:00" : iso;
  return new Date(norm).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" });
}

export function ymdInput(iso: string | null): string {
  if (!iso) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : new Date(iso).toISOString().slice(0, 10);
}

export const DISCIPLINA_LABEL: Record<string, string> = {
  ELEC: "Eléctricos",
  INST: "Instrumentistas",
  TESA: "SC Tesa",
  MIXTO: "Mixto",
};

export function EstadoPill({ estado }: { estado: string }) {
  const m = ESTADO_OT_META[estado] ?? { label: estado, color: "#64748b", bg: "#f1f5f9" };
  return (
    <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

export function BarraAvance({ pct }: { pct: number }) {
  const v = Math.min(100, Math.max(0, pct));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90 }}>
      <div style={{ flex: 1, height: 7, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${v}%`, height: "100%", background: v >= 100 ? "#15803d" : NARANJA }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#0f2847", minWidth: 30, textAlign: "right" }}>{Math.round(v)}%</span>
    </div>
  );
}

export const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
};

export const td: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  color: "#1e293b",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "middle",
};

export const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1.5px solid #e2e8f0",
  fontSize: 13,
  boxSizing: "border-box",
};

export const btnPrim: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: NARANJA,
  color: "white",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

export const btnSec: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 8,
  border: "1.5px solid #e2e8f0",
  background: "white",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  color: "#334155",
};

export const ESTADOS_OT: { value: string; label: string }[] = [
  { value: "no_iniciada", label: "No iniciada" },
  { value: "en_ejecucion", label: "En ejecución" },
  { value: "terminada", label: "Terminada" },
  { value: "con_retraso", label: "Con retraso" },
];
