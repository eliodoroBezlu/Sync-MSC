"use client";

import { useMemo, useState } from "react";
import type { ParadaDetalle, ParadaOtCli } from "./tipos";
import { fmtFecha, ymdInput, EstadoPill, DISCIPLINA_LABEL, th, td, inp, btnSec, ESTADOS_OT } from "./ui";

interface Props {
  parada: ParadaDetalle;
  puedeEditar: boolean;
  onChange: () => Promise<void>;
}

// Pestaña Preparativos: OTs con fase = "preparativos". No llevan HH al tablero;
// aquí sólo se controla responsable, fecha programada y estado. Si la OT está
// vinculada a una OT real del sistema se muestra el enlace.
export default function PanelPreparativos({ parada, puedeEditar, onChange }: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const ots = useMemo(
    () =>
      parada.ots
        .filter((o) => o.fase === "preparativos")
        .sort((a, b) => (a.fechaProg ?? "").localeCompare(b.fechaProg ?? "")),
    [parada.ots],
  );

  const conteo = {
    total: ots.length,
    terminadas: ots.filter((o) => o.estado === "terminada").length,
    retraso: ots.filter((o) => o.estado === "con_retraso").length,
  };

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
        alert(data.error ?? "Error");
        return;
      }
      setEditId(null);
      await onChange();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 13, color: "#334155", flexWrap: "wrap" }}>
        <span><strong>{conteo.total}</strong> tareas de preparación</span>
        <span style={{ color: "#15803d" }}><strong>{conteo.terminadas}</strong> listas</span>
        <span style={{ color: "#b91c1c" }}><strong>{conteo.retraso}</strong> con retraso</span>
        <span style={{ marginLeft: "auto", color: "#94a3b8" }}>
          Desde {fmtFecha(parada.fechaPreparativosInicio)} · sin cómputo de HH
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={th}>N° OT</th>
              <th style={th}>Descripción</th>
              <th style={th}>Disc.</th>
              <th style={th}>Responsable</th>
              <th style={th}>F. prog.</th>
              <th style={th}>Estado</th>
              <th style={th}>OT sistema</th>
              {puedeEditar && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {ots.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: "center", color: "#94a3b8" }} colSpan={puedeEditar ? 8 : 7}>
                  No hay tareas de preparativos. Agrégalas en Configuración o marca OTs existentes con fase «Preparativos».
                </td>
              </tr>
            )}
            {ots.map((o) =>
              editId === o.id ? (
                <FilaEdicion key={o.id} ot={o} guardando={guardando} onSave={(p) => patchOt(o.id, p)} onCancel={() => setEditId(null)} />
              ) : (
                <tr key={o.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{o.numeroOT}</td>
                  <td style={{ ...td, maxWidth: 320 }}>{o.descripcion}</td>
                  <td style={td}>{DISCIPLINA_LABEL[o.disciplina] ?? o.disciplina}</td>
                  <td style={td}>{o.responsable || "—"}</td>
                  <td style={td}>{fmtFecha(o.fechaProg)}</td>
                  <td style={td}><EstadoPill estado={o.estado} /></td>
                  <td style={td}>
                    {o.ordenTrabajoId ? (
                      <a href={`/ordenes/${o.ordenTrabajoId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>
                        ver OT →
                      </a>
                    ) : (
                      <span style={{ fontSize: 12, color: "#cbd5e1" }}>no vinculada</span>
                    )}
                  </td>
                  {puedeEditar && (
                    <td style={td}>
                      <button onClick={() => setEditId(o.id)} style={{ ...btnSec, padding: "4px 10px" }}>Editar</button>
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
    responsable: ot.responsable ?? "",
    fechaProg: ymdInput(ot.fechaProg),
    estado: ot.estado,
    observaciones: ot.observaciones ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <tr style={{ background: "#fffbeb" }}>
      <td style={{ ...td, fontWeight: 700 }}>{ot.numeroOT}</td>
      <td style={td} colSpan={1}>{ot.descripcion}</td>
      <td style={td}>{DISCIPLINA_LABEL[ot.disciplina] ?? ot.disciplina}</td>
      <td style={td}><input value={f.responsable} onChange={(e) => set("responsable", e.target.value)} style={inp} placeholder="Responsable" /></td>
      <td style={td}><input type="date" value={f.fechaProg} onChange={(e) => set("fechaProg", e.target.value)} style={{ ...inp, width: 130 }} /></td>
      <td style={td}>
        <select value={f.estado} onChange={(e) => set("estado", e.target.value)} style={inp}>
          {ESTADOS_OT.map((e) => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
      </td>
      <td style={td}></td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            disabled={guardando}
            onClick={() =>
              onSave({
                responsable: f.responsable || null,
                fechaProg: f.fechaProg || null,
                estado: f.estado,
                observaciones: f.observaciones || null,
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
