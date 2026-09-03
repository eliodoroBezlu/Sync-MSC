"use client";

import type { TableroParada as TableroData } from "@/lib/parada/tipos";
import { NARANJA } from "./tipos";

interface Props {
  tablero: TableroData;
  hoy: string; // YYYY-MM-DD seleccionado
}

const NAVY = "#0f2847";

function Anillo({ pct, plan }: { pct: number; plan: number }) {
  const size = 84;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const planAngle = (Math.min(100, Math.max(0, plan)) / 100) * 360 - 90;
  const planX = size / 2 + r * Math.cos((planAngle * Math.PI) / 180);
  const planY = size / 2 + r * Math.sin((planAngle * Math.PI) / 180);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={NARANJA}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <circle cx={planX} cy={planY} r={3.5} fill={NAVY} />
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={800} fill={NAVY}>
        {Math.round(pct)}%
      </text>
      <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" fontSize={8} fill="#64748b">
        plan {Math.round(plan)}%
      </text>
    </svg>
  );
}

function CurvaSerie({ serie }: { serie: TableroData["serieDiaria"] }) {
  const w = 150;
  const h = 56;
  const pad = 4;
  if (serie.length === 0) return null;
  const n = serie.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - (v / 100) * (h - 2 * pad);
  const linea = (key: "avancePlanAcum" | "avanceRealAcum") =>
    serie.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line x1={pad} y1={y(0)} x2={w - pad} y2={y(0)} stroke="#e2e8f0" strokeWidth={1} />
      <line x1={pad} y1={y(50)} x2={w - pad} y2={y(50)} stroke="#f1f5f9" strokeWidth={1} />
      <path d={linea("avancePlanAcum")} fill="none" stroke={NAVY} strokeWidth={1.5} strokeDasharray="3 2" />
      <path d={linea("avanceRealAcum")} fill="none" stroke={NARANJA} strokeWidth={2} />
      {serie.map((p, i) => (
        <circle key={p.fecha} cx={x(i)} cy={y(p.avanceRealAcum)} r={2.5} fill={NARANJA} />
      ))}
    </svg>
  );
}

function Celda({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 16px", borderLeft: "1px solid #e2e8f0" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function TableroParada({ tablero, hoy }: Props) {
  const { avanceGlobalPct, ots, cumplimientoHoy, porDisciplina, hh, diaActual } = tablero;
  const ejec = ots.ejecucion;
  const cumplPct = Math.round(cumplimientoHoy * 100);

  return (
    <div
      style={{
        background: "white",
        borderRadius: 14,
        border: "1.5px solid #e2e8f0",
        boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
        padding: "14px 4px",
        display: "flex",
        alignItems: "stretch",
        overflowX: "auto",
      }}
    >
      {/* Anillo de avance global */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "0 16px", minWidth: 110 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Avance global
        </span>
        <Anillo pct={avanceGlobalPct} plan={diaActual.avancePlan} />
      </div>

      {/* Día actual */}
      <Celda label="Jornada">
        <span style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{diaActual.etiqueta}</span>
        <span style={{ fontSize: 11, color: diaActual.previa ? "#d97706" : "#64748b" }}>
          {diaActual.previa ? "Aún en preparativos" : `Real ${diaActual.avanceReal}% · Plan ${diaActual.avancePlan}%`}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>hoy: {hoy}</span>
      </Celda>

      {/* OTs de ejecución por estado */}
      <Celda label="OTs ejecución">
        <span style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>
          {ejec.terminadas}/{ejec.total}
        </span>
        <div style={{ display: "flex", gap: 6, fontSize: 10 }}>
          <span style={{ color: "#15803d" }}>✓ {ejec.terminadas}</span>
          <span style={{ color: "#0369a1" }}>▶ {ejec.enEjecucion}</span>
          <span style={{ color: "#b91c1c" }}>⚠ {ejec.conRetraso}</span>
          <span style={{ color: "#64748b" }}>○ {ejec.noIniciadas}</span>
        </div>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>Prep.: {ots.preparativos.terminadas}/{ots.preparativos.total}</span>
      </Celda>

      {/* Cumplimiento hoy */}
      <Celda label="Cumpl. programa">
        <span style={{ fontSize: 18, fontWeight: 800, color: cumplPct >= 90 ? "#15803d" : cumplPct >= 70 ? "#d97706" : "#b91c1c" }}>
          {cumplPct}%
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>OTs prog. terminadas al día</span>
      </Celda>

      {/* HH */}
      <Celda label="HH ejecución">
        <span style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>
          {hh.hhReal}<span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}> / {hh.hhEst}</span>
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>
          Factor prod. {hh.factorProductividad || "—"}
        </span>
      </Celda>

      {/* Por disciplina */}
      <Celda label="Por disciplina">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {(["ELEC", "INST", "TESA"] as const).map((d) => {
            const x = porDisciplina[d];
            return (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ width: 34, fontWeight: 700, color: "#64748b" }}>{d}</span>
                <div style={{ width: 46, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${x.avancePct}%`, height: "100%", background: NARANJA }} />
                </div>
                <span style={{ color: NAVY, fontWeight: 600, minWidth: 28 }}>{x.avancePct}%</span>
                <span style={{ color: "#94a3b8" }}>{x.otsTerminadas}/{x.otsTotal}</span>
              </div>
            );
          })}
        </div>
      </Celda>

      {/* Serie diaria plan vs real */}
      <Celda label="Curva plan / real">
        <CurvaSerie serie={tablero.serieDiaria} />
        <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#94a3b8" }}>
          <span style={{ color: NARANJA }}>━ real</span>
          <span style={{ color: NAVY }}>┅ plan</span>
        </div>
      </Celda>
    </div>
  );
}
