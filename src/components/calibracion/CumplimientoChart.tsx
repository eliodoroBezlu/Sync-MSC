"use client";

import { useState } from "react";

export type PeriodoKpi = {
  clave: string;
  etiqueta: string;
  programadas: number;
  enPlazo: number;
  atrasadas: number;
  vencidas: number;
  porVencer: number;
  sinRegistro: number;
  exigibles: number;
  cumplimiento: number | null;
  aTiempo: number | null;
};

type Props = {
  periodos: PeriodoKpi[];
  vista: "mes" | "semana";
};

const ALTO = 240;
const MARGEN = { sup: 16, der: 44, inf: 30, izq: 36 };
const ANCHO_MIN_COLUMNA = { mes: 64, semana: 30 };
const COLOR_PROGRAMADO = "#94a3b8";
const COLOR_EN_PLAZO = "#0f2847";
const COLOR_ATRASO = "#d97706";
const COLOR_LINEA = "#16a34a";

function techoEscala(maximo: number): number {
  if (maximo <= 10) return Math.max(5, Math.ceil(maximo / 5) * 5);
  const paso = maximo <= 50 ? 10 : maximo <= 200 ? 25 : 50;
  return Math.ceil(maximo / paso) * paso;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default function CumplimientoChart({ periodos, vista }: Props) {
  const [activo, setActivo] = useState<string | null>(null);

  const anchoColumna = ANCHO_MIN_COLUMNA[vista];
  const ancho = MARGEN.izq + MARGEN.der + Math.max(periodos.length, 1) * anchoColumna;
  const areaAlto = ALTO - MARGEN.sup - MARGEN.inf;
  const maximo = techoEscala(Math.max(1, ...periodos.map((p) => p.programadas)));
  const y = (v: number): number => MARGEN.sup + areaAlto - (v / maximo) * areaAlto;
  const yPct = (v: number): number => MARGEN.sup + areaAlto - v * areaAlto;
  const barra = Math.min(22, (anchoColumna - 10) / 2);
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maximo * f));

  const puntosLinea = periodos
    .map((p, i) => ({ p, x: MARGEN.izq + i * anchoColumna + anchoColumna / 2 }))
    .filter(({ p }) => p.cumplimiento !== null);
  const trazo = puntosLinea
    .map(({ p, x }, i) => `${i === 0 ? "M" : "L"}${x},${yPct(p.cumplimiento ?? 0)}`)
    .join(" ");
  const seleccionado = periodos.find((p) => p.clave === activo) ?? null;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${ancho} ${ALTO}`}
          width={ancho}
          height={ALTO}
          role="group"
          aria-label="Calibraciones programadas, ejecutadas y porcentaje de cumplimiento por período"
          style={{ display: "block", minWidth: "100%" }}
        >
          <defs>
            <pattern id="sin-registro" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#f1f5f9" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="2" />
            </pattern>
          </defs>

          {marcas.map((m) => (
            <g key={m}>
              <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={y(m)} y2={y(m)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={MARGEN.izq - 6} y={y(m) + 3} textAnchor="end" fontSize="10" fill="#64748b">{m}</text>
            </g>
          ))}
          {[0, 0.5, 1].map((f) => (
            <text key={f} x={ancho - MARGEN.der + 6} y={yPct(f) + 3} fontSize="10" fill={COLOR_LINEA}>
              {Math.round(f * 100)}%
            </text>
          ))}

          {periodos.map((p, i) => {
            const x0 = MARGEN.izq + i * anchoColumna + (anchoColumna - 2 * barra - 2) / 2;
            const ejecutadas = p.enPlazo + p.atrasadas;
            const sinDatos = p.exigibles === 0 && p.sinRegistro > 0;
            const resaltado = activo === p.clave;
            return (
              <g
                key={p.clave}
                tabIndex={0}
                role="group"
                aria-label={`${p.etiqueta}: ${p.programadas} programadas, ${ejecutadas} ejecutadas, cumplimiento ${pct(p.cumplimiento)}${sinDatos ? ", sin registro en el sistema" : ""}`}
                onMouseEnter={() => setActivo(p.clave)}
                onMouseLeave={() => setActivo(null)}
                onFocus={() => setActivo(p.clave)}
                onBlur={() => setActivo(null)}
                style={{ outline: "none", cursor: "default" }}
              >
                <rect
                  x={MARGEN.izq + i * anchoColumna + 1}
                  y={MARGEN.sup}
                  width={anchoColumna - 2}
                  height={areaAlto + 14}
                  fill={resaltado ? "#eff6ff" : "transparent"}
                  stroke={resaltado ? COLOR_EN_PLAZO : "none"}
                  strokeWidth="1.5"
                  rx="4"
                />
                <rect
                  x={x0}
                  y={y(p.programadas)}
                  width={barra}
                  height={Math.max(0, MARGEN.sup + areaAlto - y(p.programadas))}
                  fill={sinDatos ? "url(#sin-registro)" : "white"}
                  stroke={COLOR_PROGRAMADO}
                  strokeWidth="1.5"
                />
                <rect
                  x={x0 + barra + 2}
                  y={y(p.enPlazo)}
                  width={barra}
                  height={Math.max(0, MARGEN.sup + areaAlto - y(p.enPlazo))}
                  fill={COLOR_EN_PLAZO}
                />
                <rect
                  x={x0 + barra + 2}
                  y={y(ejecutadas)}
                  width={barra}
                  height={Math.max(0, y(p.enPlazo) - y(ejecutadas))}
                  fill={COLOR_ATRASO}
                />
                {sinDatos && (
                  <text x={MARGEN.izq + i * anchoColumna + anchoColumna / 2} y={y(p.programadas) - 5} textAnchor="middle" fontSize="9" fill="#64748b">
                    s/reg.
                  </text>
                )}
                <text
                  x={MARGEN.izq + i * anchoColumna + anchoColumna / 2}
                  y={ALTO - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={resaltado ? 700 : 400}
                  fill={resaltado ? "#0f2847" : "#64748b"}
                >
                  {p.etiqueta}
                </text>
              </g>
            );
          })}

          <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={yPct(1)} y2={yPct(1)} stroke={COLOR_LINEA} strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
          {trazo && <path d={trazo} fill="none" stroke={COLOR_LINEA} strokeWidth="2" strokeLinejoin="round" pointerEvents="none" />}
          {puntosLinea.map(({ p, x }) => (
            <circle key={p.clave} cx={x} cy={yPct(p.cumplimiento ?? 0)} r={activo === p.clave ? 5 : 3} fill="white" stroke={COLOR_LINEA} strokeWidth="2" pointerEvents="none" />
          ))}
        </svg>
      </div>

      <div
        aria-live="polite"
        style={{ minHeight: 38, marginTop: 8, fontSize: 12, color: "#334155", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px" }}
      >
        {seleccionado ? (
          <span>
            <strong>{seleccionado.etiqueta}</strong>: {seleccionado.programadas} programadas ·{" "}
            {seleccionado.enPlazo} en plazo · {seleccionado.atrasadas} con atraso · {seleccionado.vencidas} vencidas
            {seleccionado.porVencer > 0 && ` · ${seleccionado.porVencer} por vencer`}
            {seleccionado.sinRegistro > 0 && ` · ${seleccionado.sinRegistro} sin registro en el sistema (excluidas del KPI)`}
            {" · "}cumplimiento <strong>{pct(seleccionado.cumplimiento)}</strong> (a tiempo {pct(seleccionado.aTiempo)})
          </span>
        ) : (
          <span style={{ color: "#94a3b8" }}>Pase el cursor o enfoque una columna para ver el detalle del período.</span>
        )}
      </div>

      <ul style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", listStyle: "none", padding: 0, margin: "10px 0 0", fontSize: 11, color: "#475569" }}>
        <li><Muestra color="white" borde={COLOR_PROGRAMADO} /> Programado</li>
        <li><Muestra color={COLOR_EN_PLAZO} /> Ejecutado en plazo</li>
        <li><Muestra color={COLOR_ATRASO} /> Ejecutado con atraso</li>
        <li><Muestra color={COLOR_LINEA} redondo /> % cumplimiento</li>
        <li><Muestra color="#cbd5e1" /> Sin registro en el sistema (excluido)</li>
      </ul>
    </div>
  );
}

function Muestra({ color, borde, redondo }: { color: string; borde?: string; redondo?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        marginRight: 5,
        background: color,
        border: borde ? `1.5px solid ${borde}` : "none",
        borderRadius: redondo ? "50%" : 2,
        verticalAlign: "-1px",
      }}
    />
  );
}
