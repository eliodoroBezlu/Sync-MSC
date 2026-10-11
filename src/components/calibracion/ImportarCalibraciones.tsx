"use client";

import { useRef, useState } from "react";

type Destino = {
  clave: "programa" | "historico";
  titulo: string;
  ayuda: string;
  url: string;
};

const DESTINOS: Destino[] = [
  {
    clave: "programa",
    titulo: "Programa de calibración",
    ayuda: 'Excel "Reporte_Calibracion" (hoja "Base Datos Calibracion"). Solo se usan TAG y fecha planificada.',
    url: "/api/calibracion/programa/importar",
  },
  {
    clave: "historico",
    titulo: "Histórico 2014–2026",
    ayuda: 'Planilla "ReporteCalibracionPlanilla" (hoja "ci_ReporteCalibracionPlanilla"). Puede tardar un minuto.',
    url: "/api/calibracion/historico/importar",
  },
];

type Resultado = { ok: boolean; texto: string };

function describir(j: Record<string, unknown>): string {
  if (j.ok !== true) return String(j.error ?? "Error al importar");
  const partes = [`${j.leidas} filas leídas`, `${j.nuevas} nuevas`];
  if (typeof j.actualizadas === "number") partes.push(`${j.actualizadas} actualizadas`);
  if (typeof j.yaExistian === "number") partes.push(`${j.yaExistian} ya existían`);
  if (Number(j.omitidas) > 0) partes.push(`${j.omitidas} omitidas`);
  return partes.join(" · ");
}

export default function ImportarCalibraciones({ onTerminado }: { onTerminado: () => void }) {
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const entradas = useRef<Record<string, HTMLInputElement | null>>({});

  async function subir(destino: Destino, archivo: File) {
    setEnCurso(destino.clave);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      const res = await fetch(destino.url, { method: "POST", body: form });
      const j = (await res.json().catch(() => ({ ok: false, error: `Error ${res.status}` }))) as Record<string, unknown>;
      setResultados((prev) => ({ ...prev, [destino.clave]: { ok: j.ok === true, texto: describir(j) } }));
      if (j.ok === true) onTerminado();
    } catch {
      setResultados((prev) => ({ ...prev, [destino.clave]: { ok: false, texto: "No se pudo conectar con el servidor" } }));
    } finally {
      setEnCurso(null);
      const entrada = entradas.current[destino.clave];
      if (entrada) entrada.value = "";
    }
  }

  return (
    <details style={{ marginTop: 16 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#0f2847" }}>
        Importar datos (Admin / Superintendente)
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
        {DESTINOS.map((d) => {
          const r = resultados[d.clave];
          const ocupado = enCurso === d.clave;
          return (
            <div key={d.clave} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f2847" }}>{d.titulo}</div>
              <p style={{ fontSize: 11, color: "#64748b", margin: "4px 0 10px" }}>{d.ayuda}</p>
              <input
                ref={(el) => { entradas.current[d.clave] = el; }}
                type="file"
                accept=".xlsx"
                disabled={enCurso !== null}
                aria-label={`Archivo para ${d.titulo}`}
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  if (archivo) void subir(d, archivo);
                }}
                style={{ fontSize: 12, maxWidth: "100%" }}
              />
              <div role="status" style={{ fontSize: 12, marginTop: 8, color: r ? (r.ok ? "#15803d" : "#b91c1c") : "#64748b" }}>
                {ocupado ? "Importando…" : r?.texto}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
