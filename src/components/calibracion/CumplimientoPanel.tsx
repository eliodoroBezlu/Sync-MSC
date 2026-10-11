"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/context/AuthContext";
import CumplimientoChart, { type PeriodoKpi } from "./CumplimientoChart";
import ImportarCalibraciones from "./ImportarCalibraciones";

type Vista = "mes" | "semana";

type Vencida = {
  tag: string;
  fechaPlan: string;
  origen: string;
  programa: string;
  diasAtraso: number | null;
};

type Respuesta = {
  ok: boolean;
  hoy: string;
  programaCargado: boolean;
  periodos: PeriodoKpi[];
  resumen: PeriodoKpi;
  vencidas: Vencida[];
  totalVencidas: number;
  fueraDePrograma: number;
};

const ROLES_IMPORTACION = [1, 2];
const ORIGENES = [
  { valor: "todos", texto: "Todos" },
  { valor: "WG", texto: "WG" },
  { valor: "Parada", texto: "Parada" },
];
const VENCIDAS_VISIBLES = 15;

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function colorCumplimiento(v: number | null): string {
  if (v === null) return "#64748b";
  if (v >= 0.9) return "#16a34a";
  return v >= 0.75 ? "#d97706" : "#dc2626";
}

function fmtYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

const estiloControl = {
  fontSize: 12,
  padding: "6px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "white",
  color: "#0f2847",
  cursor: "pointer",
} as const;

function Segmentado<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambio,
}: {
  etiqueta: string;
  opciones: { valor: T; texto: string }[];
  valor: T;
  onCambio: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={etiqueta} style={{ display: "inline-flex", border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden" }}>
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambio(o.valor)}
            style={{
              fontSize: 12,
              fontWeight: activo ? 700 : 500,
              padding: "6px 12px",
              border: "none",
              cursor: "pointer",
              background: activo ? "#0f2847" : "white",
              color: activo ? "white" : "#334155",
            }}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

function Cifra({ etiqueta, valor, nota, color }: { etiqueta: string; valor: string; nota: string; color: string }) {
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderLeft: `4px solid ${color}`, borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{etiqueta}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1, marginTop: 4 }}>{valor}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{nota}</div>
    </div>
  );
}

export default function CumplimientoPanel() {
  const { user } = useUser();
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [vista, setVista] = useState<Vista>("mes");
  const [origen, setOrigen] = useState("todos");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consultado, setConsultado] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [verTodas, setVerTodas] = useState(false);

  const consulta = `${anio}|${vista}|${origen}|${recarga}`;
  const cargando = consultado !== consulta;

  useEffect(() => {
    const control = new AbortController();
    const url = `/api/calibracion/cumplimiento?anio=${anio}&vista=${vista}&origen=${origen}`;
    (async () => {
      try {
        const res = await fetch(url, { signal: control.signal });
        const j = (await res.json()) as Respuesta & { error?: string };
        if (!res.ok || !j.ok) throw new Error(j.error ?? `Error ${res.status}`);
        setDatos(j);
        setError(null);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "No se pudo cargar el cumplimiento");
      }
      setConsultado(consulta);
    })();
    return () => control.abort();
  }, [anio, vista, origen, consulta]);

  const puedeImportar = user ? ROLES_IMPORTACION.includes(user.rol) : false;
  const anios = Array.from({ length: 4 }, (_, i) => anioActual - i);
  const resumen = datos?.resumen;
  const vencidas = datos?.vencidas ?? [];
  const vencidasMostradas = verTodas ? vencidas : vencidas.slice(0, VENCIDAS_VISIBLES);

  return (
    <section aria-labelledby="titulo-cumplimiento" style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h2 id="titulo-cumplimiento" style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#0f2847" }}>
            Cumplimiento del programa: programado vs ejecutado
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
            Una calibración con atraso cuenta como cumplida, pero se muestra aparte. Los períodos sin ningún registro en el sistema se excluyen.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
            Año
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={estiloControl}>
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <Segmentado etiqueta="Agrupar por" valor={vista} onCambio={setVista} opciones={[{ valor: "mes", texto: "Mes" }, { valor: "semana", texto: "Semana" }]} />
          <Segmentado etiqueta="Programa" valor={origen} onCambio={setOrigen} opciones={ORIGENES} />
        </div>
      </div>

      {error && (
        <div role="alert" style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {datos && !datos.programaCargado && (
        <div style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 12 }}>
          Todavía no hay un programa de calibración cargado.
          {puedeImportar ? " Impórtelo abajo en “Importar datos”." : " Pida a un administrador que lo importe."}
        </div>
      )}

      {resumen && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
          <Cifra etiqueta="Cumplimiento" valor={pct(resumen.cumplimiento)} nota={`${resumen.enPlazo + resumen.atrasadas} de ${resumen.exigibles} exigibles`} color={colorCumplimiento(resumen.cumplimiento)} />
          <Cifra etiqueta="A tiempo" valor={pct(resumen.aTiempo)} nota={`${resumen.enPlazo} en plazo`} color={colorCumplimiento(resumen.aTiempo)} />
          <Cifra etiqueta="Con atraso" valor={String(resumen.atrasadas)} nota="cumplidas fuera de plazo" color="#d97706" />
          <Cifra etiqueta="Vencidas" valor={String(resumen.vencidas)} nota="sin calibración" color={resumen.vencidas > 0 ? "#dc2626" : "#16a34a"} />
          <Cifra etiqueta="Programadas" valor={String(resumen.programadas)} nota={`${resumen.porVencer} por vencer · ${resumen.sinRegistro} sin registro`} color="#0f2847" />
          <Cifra etiqueta="Fuera de programa" valor={String(datos?.fueraDePrograma ?? 0)} nota="calibraciones no programadas" color="#64748b" />
        </div>
      )}

      <div aria-busy={cargando} style={{ opacity: cargando ? 0.55 : 1, transition: "opacity 0.2s" }}>
        {datos && datos.periodos.length > 0 ? (
          <CumplimientoChart periodos={datos.periodos} vista={vista} />
        ) : (
          !cargando && <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "24px 0" }}>No hay programación para {anio}.</p>
        )}
      </div>

      {vencidas.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#dc2626" }}>
            Calibraciones vencidas sin ejecutar ({datos?.totalVencidas ?? vencidas.length})
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["TAG", "Fecha planificada", "Programa", "Días de atraso"].map((h) => (
                    <th key={h} scope="col" style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", textAlign: "left", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vencidasMostradas.map((v) => (
                  <tr key={`${v.tag}-${v.fechaPlan}-${v.programa}`}>
                    <td style={{ padding: "7px 10px", fontSize: 13, fontWeight: 700, color: "#0f2847", borderBottom: "1px solid #f1f5f9" }}>{v.tag}</td>
                    <td style={{ padding: "7px 10px", fontSize: 13, borderBottom: "1px solid #f1f5f9" }}>{fmtYmd(v.fechaPlan)}</td>
                    <td style={{ padding: "7px 10px", fontSize: 12, color: "#475569", borderBottom: "1px solid #f1f5f9" }}>{v.programa}</td>
                    <td style={{ padding: "7px 10px", fontSize: 13, fontWeight: 700, color: "#dc2626", borderBottom: "1px solid #f1f5f9" }}>{v.diasAtraso ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vencidas.length > VENCIDAS_VISIBLES && (
            <button type="button" onClick={() => setVerTodas((v) => !v)} style={{ ...estiloControl, marginTop: 8 }}>
              {verTodas ? "Ver menos" : `Ver las ${vencidas.length}`}
            </button>
          )}
        </div>
      )}

      {puedeImportar && <ImportarCalibraciones onTerminado={() => setRecarga((n) => n + 1)} />}
    </section>
  );
}
