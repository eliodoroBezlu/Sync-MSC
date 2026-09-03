"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/context/AuthContext";
import type { AvanceCli, ParadaDetalle, TurnoParada } from "./tipos";
import { EstadoPill, DISCIPLINA_LABEL, th, td, inp, btnPrim, ESTADOS_OT } from "./ui";

interface Props {
  parada: ParadaDetalle;
  puedeEditar: boolean;
  onChange: () => Promise<void>;
}

interface FilaAvance {
  avancePct: string;
  hhPropias: string;
  hhApoyo: string;
  estado: string;
  comentario: string;
}

function rangoFechas(iniIso: string, finIso: string): string[] {
  const ini = new Date(iniIso.slice(0, 10) + "T00:00:00Z");
  const fin = new Date(finIso.slice(0, 10) + "T00:00:00Z");
  const dias: string[] = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias.length ? dias : [iniIso.slice(0, 10)];
}

function etiquetaDia(ymd: string): string {
  return new Date(ymd + "T12:00:00").toLocaleDateString("es-BO", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export default function AvanceDiario({ parada, puedeEditar, onChange }: Props) {
  const { user } = useUser();
  const dias = useMemo(
    () => rangoFechas(parada.fechaEjecucionInicio, parada.fechaEjecucionFin),
    [parada.fechaEjecucionInicio, parada.fechaEjecucionFin],
  );

  const otsEjec = useMemo(
    () =>
      parada.ots
        .filter((o) => o.fase === "ejecucion")
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.numeroOT.localeCompare(b.numeroOT)),
    [parada.ots],
  );

  const [fecha, setFecha] = useState<string>(dias[0]);
  const [turno, setTurno] = useState<TurnoParada>("Dia");
  const [filas, setFilas] = useState<Record<string, FilaAvance>>({});
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const cargarAvances = useCallback(async () => {
    setCargando(true);
    setMsg("");
    try {
      const res = await fetch(`/api/paradas/${parada.id}/avances?fecha=${fecha}&turno=${turno}`);
      const data: AvanceCli[] = res.ok ? await res.json() : [];
      const porOt = new Map(data.map((a) => [a.paradaOtId, a]));
      const next: Record<string, FilaAvance> = {};
      for (const o of otsEjec) {
        const a = porOt.get(o.id);
        next[o.id] = a
          ? {
              avancePct: String(a.avancePct),
              hhPropias: String(a.hhPropias),
              hhApoyo: String(a.hhApoyo),
              estado: a.estado,
              comentario: a.comentario ?? "",
            }
          : {
              avancePct: String(o.avancePct ?? 0),
              hhPropias: "",
              hhApoyo: "",
              estado: o.estado || "no_iniciada",
              comentario: "",
            };
      }
      setFilas(next);
    } finally {
      setCargando(false);
    }
  }, [parada.id, fecha, turno, otsEjec]);

  useEffect(() => {
    cargarAvances();
  }, [cargarAvances]);

  function set(otId: string, k: keyof FilaAvance, v: string) {
    setFilas((prev) => ({ ...prev, [otId]: { ...prev[otId], [k]: v } }));
  }

  const subtot = otsEjec.reduce(
    (acc, o) => {
      const f = filas[o.id];
      if (!f) return acc;
      acc.hhPropias += Number(f.hhPropias) || 0;
      acc.hhApoyo += Number(f.hhApoyo) || 0;
      return acc;
    },
    { hhPropias: 0, hhApoyo: 0 },
  );

  async function guardar() {
    if (!user) return;
    setGuardando(true);
    setMsg("");
    try {
      const items = otsEjec
        .map((o) => {
          const f = filas[o.id];
          if (!f) return null;
          const tieneDato =
            (Number(f.hhPropias) || 0) > 0 ||
            (Number(f.hhApoyo) || 0) > 0 ||
            (Number(f.avancePct) || 0) > 0 ||
            f.estado !== "no_iniciada" ||
            f.comentario.trim() !== "";
          if (!tieneDato) return null;
          return {
            paradaOtId: o.id,
            fecha,
            turno,
            avancePct: Number(f.avancePct) || 0,
            hhPropias: Number(f.hhPropias) || 0,
            hhApoyo: Number(f.hhApoyo) || 0,
            estado: f.estado,
            comentario: f.comentario || null,
            registradoPor: user.email,
          };
        })
        .filter(Boolean);

      if (items.length === 0) {
        setMsg("No hay filas con datos para guardar.");
        return;
      }

      const res = await fetch(`/api/paradas/${parada.id}/avances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error al guardar");
        return;
      }
      const rech = (data.rechazados ?? []).length;
      setMsg(`Guardados ${data.guardados?.length ?? 0} avances${rech ? ` · ${rech} rechazados` : ""}.`);
      await onChange();
      await cargarAvances();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      {/* Selector de fecha + turno */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {dias.map((d) => (
            <button
              key={d}
              onClick={() => setFecha(d)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1.5px solid",
                borderColor: fecha === d ? "#ea580c" : "#e2e8f0",
                background: fecha === d ? "#ea580c" : "white",
                color: fecha === d ? "white" : "#334155",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {etiquetaDia(d)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          {(["Dia", "Noche"] as TurnoParada[]).map((t) => (
            <button
              key={t}
              onClick={() => setTurno(t)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1.5px solid",
                borderColor: turno === t ? "#0f2847" : "#e2e8f0",
                background: turno === t ? "#0f2847" : "white",
                color: turno === t ? "white" : "#334155",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t === "Dia" ? "Día" : "Noche"}
            </button>
          ))}
        </div>
        {puedeEditar && (
          <button onClick={guardar} disabled={guardando || cargando} style={{ ...btnPrim, marginLeft: "auto", opacity: guardando ? 0.6 : 1 }}>
            {guardando ? "Guardando…" : "Guardar avance"}
          </button>
        )}
      </div>

      {msg && (
        <div style={{ fontSize: 12, color: msg.includes("Error") || msg.includes("rechaz") ? "#b45309" : "#15803d", marginBottom: 10 }}>
          {msg}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr>
              <th style={th}>N° OT</th>
              <th style={th}>Descripción</th>
              <th style={th}>Disc.</th>
              <th style={{ ...th, textAlign: "right" }}>HH est.</th>
              <th style={{ ...th, width: 90 }}>% avance</th>
              <th style={{ ...th, width: 90 }}>HH propias</th>
              <th style={{ ...th, width: 90 }}>HH apoyo</th>
              <th style={{ ...th, width: 140 }}>Estado</th>
              <th style={th}>Comentario</th>
            </tr>
          </thead>
          <tbody>
            {otsEjec.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: "center", color: "#94a3b8" }} colSpan={9}>
                  No hay OTs de ejecución. Impórtalas o márcalas con fase «Ejecución».
                </td>
              </tr>
            )}
            {otsEjec.map((o) => {
              const f = filas[o.id];
              return (
                <tr key={o.id}>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {o.numeroOT}
                    {o.critica && <span title="crítica" style={{ color: "#b91c1c", marginLeft: 4 }}>●</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 240 }}>{o.descripcion}</td>
                  <td style={td}>{DISCIPLINA_LABEL[o.disciplina] ?? o.disciplina}</td>
                  <td style={{ ...td, textAlign: "right" }}>{o.hhEstimadas.toFixed(0)}</td>
                  <td style={td}>
                    <input type="number" min={0} max={100} disabled={!puedeEditar} value={f?.avancePct ?? ""} onChange={(e) => set(o.id, "avancePct", e.target.value)} style={inp} />
                  </td>
                  <td style={td}>
                    <input type="number" min={0} step={0.5} disabled={!puedeEditar} value={f?.hhPropias ?? ""} onChange={(e) => set(o.id, "hhPropias", e.target.value)} style={inp} />
                  </td>
                  <td style={td}>
                    <input type="number" min={0} step={0.5} disabled={!puedeEditar} value={f?.hhApoyo ?? ""} onChange={(e) => set(o.id, "hhApoyo", e.target.value)} style={inp} />
                  </td>
                  <td style={td}>
                    {puedeEditar ? (
                      <select value={f?.estado ?? "no_iniciada"} onChange={(e) => set(o.id, "estado", e.target.value)} style={inp}>
                        {ESTADOS_OT.map((e) => (
                          <option key={e.value} value={e.value}>{e.label}</option>
                        ))}
                      </select>
                    ) : (
                      <EstadoPill estado={f?.estado ?? "no_iniciada"} />
                    )}
                  </td>
                  <td style={td}>
                    <input disabled={!puedeEditar} value={f?.comentario ?? ""} onChange={(e) => set(o.id, "comentario", e.target.value)} style={inp} placeholder="—" />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={5}>
                Subtotal turno {turno === "Dia" ? "Día" : "Noche"}
              </td>
              <td style={{ ...td, fontWeight: 700 }}>{subtot.hhPropias.toFixed(1)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{subtot.hhApoyo.toFixed(1)}</td>
              <td style={{ ...td, fontWeight: 700 }}>Σ {(subtot.hhPropias + subtot.hhApoyo).toFixed(1)} HH</td>
              <td style={td}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
