"use client";

import { useMemo, useState } from "react";
import type { ParadaDetalle, ParadaOtCli } from "./tipos";
import {
  fmtFecha, ymdInput, EstadoPill, BarraAvance, DISCIPLINA_LABEL,
  th, td, inp, btnSec, ESTADOS_OT,
} from "./ui";

interface Props {
  parada: ParadaDetalle;
  puedeEditar: boolean;
  onChange: () => Promise<void>;
}

type FiltroFase = "todas" | "preparativos" | "ejecucion";
type FiltroDisc = "todas" | "ELEC" | "INST" | "TESA";
type FiltroEstado = "todos" | "no_iniciada" | "en_ejecucion" | "terminada" | "con_retraso";

export default function ListaOtsParada({ parada, puedeEditar, onChange }: Props) {
  const [fFase, setFFase] = useState<FiltroFase>("todas");
  const [fDisc, setFDisc] = useState<FiltroDisc>("todas");
  const [fEstado, setFEstado] = useState<FiltroEstado>("todos");
  const [busca, setBusca] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const ots = useMemo(() => {
    return parada.ots.filter((o) => {
      if (fFase !== "todas" && o.fase !== fFase) return false;
      if (fDisc !== "todas" && o.disciplina !== fDisc) return false;
      if (fEstado !== "todos" && o.estado !== fEstado) return false;
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (
          !o.numeroOT.toLowerCase().includes(q) &&
          !o.descripcion.toLowerCase().includes(q) &&
          !o.tag.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [parada.ots, fFase, fDisc, fEstado, busca]);

  const totHH = ots.reduce((s, o) => s + o.hhEstimadas, 0);

  async function patchOt(otId: string, patch: Partial<ParadaOtCli>) {
    setGuardando(true);
    try {
      const res = await fetch(`/api/paradas/${parada.id}/ots/${otId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.ok === false) {
        alert(data.error ?? "Error al guardar");
        return;
      }
      setEditId(null);
      await onChange();
    } finally {
      setGuardando(false);
    }
  }

  async function borrarOt(ot: ParadaOtCli) {
    if (!confirm(`¿Quitar la OT ${ot.numeroOT} del programa de la parada?`)) return;
    const res = await fetch(`/api/paradas/${parada.id}/ots/${ot.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok === false) {
      alert(data.error ?? "Error");
      return;
    }
    await onChange();
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          placeholder="Buscar N° OT, descripción o tag…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ ...inp, width: 240 }}
        />
        <select value={fFase} onChange={(e) => setFFase(e.target.value as FiltroFase)} style={{ ...inp, width: "auto" }}>
          <option value="todas">Todas las fases</option>
          <option value="preparativos">Preparativos</option>
          <option value="ejecucion">Ejecución</option>
        </select>
        <select value={fDisc} onChange={(e) => setFDisc(e.target.value as FiltroDisc)} style={{ ...inp, width: "auto" }}>
          <option value="todas">Todas las disciplinas</option>
          <option value="ELEC">Eléctricos</option>
          <option value="INST">Instrumentistas</option>
          <option value="TESA">SC Tesa</option>
        </select>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value as FiltroEstado)} style={{ ...inp, width: "auto" }}>
          <option value="todos">Todos los estados</option>
          {ESTADOS_OT.map((e) => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
          {ots.length} OTs · {totHH.toFixed(0)} HH est.
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
          <thead>
            <tr>
              <th style={th}>N° OT</th>
              <th style={th}>Descripción</th>
              <th style={th}>Tag</th>
              <th style={th}>Disc.</th>
              <th style={th}>Fase</th>
              <th style={th}>Grupo</th>
              <th style={{ ...th, textAlign: "right" }}>HH est.</th>
              <th style={th}>F. prog.</th>
              <th style={th}>Avance</th>
              <th style={th}>Estado</th>
              {puedeEditar && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {ots.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: "center", color: "#94a3b8" }} colSpan={puedeEditar ? 11 : 10}>
                  Sin OTs para el filtro actual.
                </td>
              </tr>
            )}
            {ots.map((o) =>
              editId === o.id ? (
                <FilaEdicion key={o.id} ot={o} guardando={guardando} onSave={(p) => patchOt(o.id, p)} onCancel={() => setEditId(null)} />
              ) : (
                <tr key={o.id}>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {o.numeroOT}
                    {o.critica && <span title="OT crítica" style={{ color: "#b91c1c", marginLeft: 4 }}>●</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 280 }}>{o.descripcion}</td>
                  <td style={td}>{o.tag || "—"}</td>
                  <td style={td}>{DISCIPLINA_LABEL[o.disciplina] ?? o.disciplina}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, color: o.fase === "ejecucion" ? "#ea580c" : "#d97706", fontWeight: 700 }}>
                      {o.fase === "ejecucion" ? "Ejecución" : "Preparativos"}
                    </span>
                  </td>
                  <td style={td}>{o.grupo}</td>
                  <td style={{ ...td, textAlign: "right" }}>{o.fase === "ejecucion" ? o.hhEstimadas.toFixed(0) : "—"}</td>
                  <td style={td}>{fmtFecha(o.fechaProg)}</td>
                  <td style={td}><BarraAvance pct={o.avancePct} /></td>
                  <td style={td}><EstadoPill estado={o.estado} /></td>
                  {puedeEditar && (
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setEditId(o.id)} style={{ ...btnSec, padding: "4px 10px" }}>Editar</button>
                        <button onClick={() => borrarOt(o)} style={{ ...btnSec, padding: "4px 8px", color: "#dc2626", borderColor: "#fecaca" }}>✕</button>
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaEdicion({
  ot, guardando, onSave, onCancel,
}: {
  ot: ParadaOtCli;
  guardando: boolean;
  onSave: (p: Partial<ParadaOtCli>) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    descripcion: ot.descripcion,
    tag: ot.tag,
    disciplina: ot.disciplina,
    fase: ot.fase,
    grupo: ot.grupo,
    hhEstimadas: String(ot.hhEstimadas),
    fechaProg: ymdInput(ot.fechaProg),
    avancePct: String(ot.avancePct),
    estado: ot.estado,
    critica: ot.critica,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  return (
    <tr style={{ background: "#fff7ed" }}>
      <td style={{ ...td, fontWeight: 700 }}>
        {ot.numeroOT}
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 500, marginTop: 4 }}>
          <input type="checkbox" checked={f.critica} onChange={(e) => set("critica", e.target.checked)} /> crítica
        </label>
      </td>
      <td style={td}><input value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} style={inp} /></td>
      <td style={td}><input value={f.tag} onChange={(e) => set("tag", e.target.value)} style={{ ...inp, width: 80 }} /></td>
      <td style={td}>
        <select value={f.disciplina} onChange={(e) => set("disciplina", e.target.value)} style={inp}>
          <option value="ELEC">Eléctricos</option>
          <option value="INST">Instrumentistas</option>
          <option value="TESA">SC Tesa</option>
        </select>
      </td>
      <td style={td}>
        <select value={f.fase} onChange={(e) => set("fase", e.target.value)} style={inp}>
          <option value="preparativos">Preparativos</option>
          <option value="ejecucion">Ejecución</option>
        </select>
      </td>
      <td style={td}>
        <select value={f.grupo} onChange={(e) => set("grupo", e.target.value)} style={inp}>
          <option value="Dia">Día</option>
          <option value="Noche">Noche</option>
          <option value="Ambos">Ambos</option>
        </select>
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        <input type="number" min={0} value={f.hhEstimadas} onChange={(e) => set("hhEstimadas", e.target.value)} style={{ ...inp, width: 64, textAlign: "right" }} />
      </td>
      <td style={td}><input type="date" value={f.fechaProg} onChange={(e) => set("fechaProg", e.target.value)} style={{ ...inp, width: 130 }} /></td>
      <td style={td}>
        <input type="number" min={0} max={100} value={f.avancePct} onChange={(e) => set("avancePct", e.target.value)} style={{ ...inp, width: 64 }} />
      </td>
      <td style={td}>
        <select value={f.estado} onChange={(e) => set("estado", e.target.value)} style={inp}>
          {ESTADOS_OT.map((e) => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
      </td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            disabled={guardando}
            onClick={() =>
              onSave({
                descripcion: f.descripcion,
                tag: f.tag,
                disciplina: f.disciplina,
                fase: f.fase,
                grupo: f.grupo,
                hhEstimadas: Number(f.hhEstimadas) || 0,
                fechaProg: f.fechaProg || null,
                avancePct: Number(f.avancePct) || 0,
                estado: f.estado,
                critica: f.critica,
              })
            }
            style={{ ...btnSec, padding: "4px 10px", background: "#ea580c", color: "white", borderColor: "#ea580c" }}
          >
            {guardando ? "…" : "Guardar"}
          </button>
          <button onClick={onCancel} style={{ ...btnSec, padding: "4px 10px" }}>Cancelar</button>
        </div>
      </td>
    </tr>
  );
}
