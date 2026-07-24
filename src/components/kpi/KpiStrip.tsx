"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SEMAFORO_COLOR, Semaforo } from "@/lib/kpiConfig";

type KpiSummary = {
  semana: number;
  anio: number;
  cumplimientoSemana: { pct: number | null; semaforo: Semaforo | null };
  reactivoHoy: { pct: number | null; semaforo: Semaforo | null };
  reactivoSemana: { pct: number | null; semaforo: Semaforo | null };
  correctivasNoProgramadasSemana: number;
};

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${Math.round(pct)}%`;
}

function Tile({ label, value, semaforo, sublabel }: { label: string; value: string; semaforo: Semaforo | null; sublabel: string }) {
  const color = semaforo ? SEMAFORO_COLOR[semaforo] : "#94a3b8";
  return (
    <div style={{
      flex: "1 1 130px", minWidth: 130, background: "white", borderRadius: 14,
      padding: "14px 14px 12px", border: "1px solid #e2e8f0",
      borderTop: `3px solid ${color}`, boxShadow: "0 2px 12px rgba(15,40,71,0.06)",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sublabel}</div>
    </div>
  );
}

export default function KpiStrip() {
  const [data, setData] = useState<KpiSummary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ordenes/kpi", { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setData(json.data);
        else setError(true);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: "1 1 130px", minWidth: 130, height: 78, background: "#e2e8f0", borderRadius: 14, opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  if (error || !data) return null;

  return (
    <Link href="/ordenes/indicadores" style={{ textDecoration: "none", display: "block", marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Tile
          label="Cumplimiento"
          value={formatPct(data.cumplimientoSemana.pct)}
          semaforo={data.cumplimientoSemana.semaforo}
          sublabel={`Semana ${data.semana}`}
        />
        <Tile
          label="Reactivo hoy"
          value={formatPct(data.reactivoHoy.pct)}
          semaforo={data.reactivoHoy.semaforo}
          sublabel="% HH no programado"
        />
        <Tile
          label="Reactivo semana"
          value={formatPct(data.reactivoSemana.pct)}
          semaforo={data.reactivoSemana.semaforo}
          sublabel="% HH no programado"
        />
        <Tile
          label="Correctivas"
          value={String(data.correctivasNoProgramadasSemana)}
          semaforo={null}
          sublabel="CMP/CMR no programadas"
        />
      </div>
    </Link>
  );
}
