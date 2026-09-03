"use client";

import { useMemo, useRef, useState } from "react";
import type { DisciplinaParada } from "@/lib/parada/tipos";
import type { EstadoParada, ParadaDetalle, ParadaGrupoCli, TurnoParada } from "./tipos";
import { ymdInput, DISCIPLINA_LABEL, inp, btnPrim, btnSec, th, td } from "./ui";

interface Props {
  parada: ParadaDetalle;
  onChange: () => Promise<void>;
  onDeleted: () => void;
}

const DISCIPLINAS: DisciplinaParada[] = ["ELEC", "INST", "TESA"];
const TURNOS: TurnoParada[] = ["Dia", "Noche"];

const seccion: React.CSSProperties = {
  border: "1.5px solid #e2e8f0",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const h3: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: "#0f2847", margin: "0 0 12px" };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" };
const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, minWidth: 130 };

export default function ConfigParada({ parada, onChange, onDeleted }: Props) {
  return (
    <div>
      <SeccionDatos parada={parada} onChange={onChange} />
      <SeccionGrupos parada={parada} onChange={onChange} />
      <SeccionImportar paradaId={parada.id} onChange={onChange} />
      <SeccionOtManual paradaId={parada.id} onChange={onChange} />
      <SeccionPeligro paradaId={parada.id} codigo={parada.codigo} onDeleted={onDeleted} />
    </div>
  );
}

/* ── Datos de la parada ─────────────────────────────────────────────────── */
function SeccionDatos({ parada, onChange }: { parada: ParadaDetalle; onChange: () => Promise<void> }) {
  const [f, setF] = useState({
    nombre: parada.nombre,
    planta: parada.planta ?? "",
    fechaPreparativosInicio: ymdInput(parada.fechaPreparativosInicio),
    fechaEjecucionInicio: ymdInput(parada.fechaEjecucionInicio),
    fechaEjecucionFin: ymdInput(parada.fechaEjecucionFin),
    estado: parada.estado as EstadoParada,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/paradas/${parada.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: f.nombre,
          planta: f.planta || null,
          fechaPreparativosInicio: f.fechaPreparativosInicio,
          fechaEjecucionInicio: f.fechaEjecucionInicio,
          fechaEjecucionFin: f.fechaEjecucionFin,
          estado: f.estado,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error al guardar");
        return;
      }
      setMsg("Datos guardados.");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={seccion}>
      <h3 style={h3}>Datos de la parada</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ ...campo, flex: 1, minWidth: 200 }}>
          <span style={lbl}>Nombre</span>
          <input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} style={inp} />
        </label>
        <label style={campo}>
          <span style={lbl}>Planta</span>
          <input value={f.planta} onChange={(e) => set("planta", e.target.value)} style={inp} placeholder="—" />
        </label>
        <label style={campo}>
          <span style={lbl}>Estado</span>
          <select value={f.estado} onChange={(e) => set("estado", e.target.value as EstadoParada)} style={inp}>
            <option value="preparativos">Preparativos</option>
            <option value="ejecucion">En ejecución</option>
            <option value="cerrada">Cerrada</option>
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={campo}>
          <span style={lbl}>Inicio preparativos</span>
          <input type="date" value={f.fechaPreparativosInicio} onChange={(e) => set("fechaPreparativosInicio", e.target.value)} style={inp} />
        </label>
        <label style={campo}>
          <span style={lbl}>Inicio ejecución</span>
          <input type="date" value={f.fechaEjecucionInicio} onChange={(e) => set("fechaEjecucionInicio", e.target.value)} style={inp} />
        </label>
        <label style={campo}>
          <span style={lbl}>Fin ejecución</span>
          <input type="date" value={f.fechaEjecucionFin} onChange={(e) => set("fechaEjecucionFin", e.target.value)} style={inp} />
        </label>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={guardar} disabled={busy} style={btnPrim}>
          {busy ? "Guardando…" : "Guardar datos"}
        </button>
        {msg && <span style={{ fontSize: 12, color: msg.includes("Error") ? "#dc2626" : "#15803d" }}>{msg}</span>}
      </div>
    </div>
  );
}

/* ── Grupos Día / Noche ─────────────────────────────────────────────────── */
function SeccionGrupos({ parada, onChange }: { parada: ParadaDetalle; onChange: () => Promise<void> }) {
  const porClave = useMemo(() => {
    const m = new Map<string, ParadaGrupoCli>();
    for (const g of parada.grupos) m.set(`${g.turno}|${g.disciplina}`, g);
    return m;
  }, [parada.grupos]);

  return (
    <div style={seccion}>
      <h3 style={h3}>Dotación por grupo</h3>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
        «Apoyo» es cabeza de personal de contratista sumada al grupo — sólo un número, sin nombres ni usuarios.
      </p>
      {TURNOS.map((turno) => (
        <div key={turno} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#ea580c", marginBottom: 6 }}>
            Turno {turno === "Dia" ? "Día" : "Noche"}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Disciplina</th>
                  <th style={th}>Supervisor</th>
                  <th style={{ ...th, width: 110 }}>Dot. propia</th>
                  <th style={{ ...th, width: 110 }}>Dot. apoyo</th>
                  <th style={{ ...th, width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {DISCIPLINAS.map((disc) => (
                  <FilaGrupo
                    key={disc}
                    paradaId={parada.id}
                    turno={turno}
                    disciplina={disc}
                    grupo={porClave.get(`${turno}|${disc}`) ?? null}
                    onChange={onChange}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilaGrupo({
  paradaId, turno, disciplina, grupo, onChange,
}: {
  paradaId: string;
  turno: TurnoParada;
  disciplina: DisciplinaParada;
  grupo: ParadaGrupoCli | null;
  onChange: () => Promise<void>;
}) {
  const [f, setF] = useState({
    supervisorNombre: grupo?.supervisorNombre ?? "",
    dotacionPropia: String(grupo?.dotacionPropia ?? ""),
    dotacionApoyo: String(grupo?.dotacionApoyo ?? ""),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setBusy(true);
    try {
      const res = await fetch(`/api/paradas/${paradaId}/grupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turno,
          disciplina,
          supervisorNombre: f.supervisorNombre,
          dotacionPropia: Number(f.dotacionPropia) || 0,
          dotacionApoyo: Number(f.dotacionApoyo) || 0,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        alert(data.error ?? "Error");
        return;
      }
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td style={{ ...td, fontWeight: 700 }}>{DISCIPLINA_LABEL[disciplina]}</td>
      <td style={td}>
        <input value={f.supervisorNombre} onChange={(e) => set("supervisorNombre", e.target.value)} style={inp} placeholder="Nombre del supervisor" />
      </td>
      <td style={td}>
        <input type="number" min={0} value={f.dotacionPropia} onChange={(e) => set("dotacionPropia", e.target.value)} style={inp} />
      </td>
      <td style={td}>
        <input type="number" min={0} value={f.dotacionApoyo} onChange={(e) => set("dotacionApoyo", e.target.value)} style={inp} />
      </td>
      <td style={td}>
        <button onClick={guardar} disabled={busy} style={{ ...btnSec, padding: "4px 10px" }}>
          {busy ? "…" : grupo ? "Actualizar" : "Crear"}
        </button>
      </td>
    </tr>
  );
}

/* ── Importar OTs + vincular ────────────────────────────────────────────── */
function SeccionImportar({ paradaId, onChange }: { paradaId: string; onChange: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function importar(file: File) {
    setBusy(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/paradas/${paradaId}/importar`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error al importar");
        return;
      }
      setMsg(
        `Importadas ${data.importadas} · ${data.duplicadasOmitidas} duplicadas omitidas` +
          (data.sinDisciplina ? ` · ${data.sinDisciplina} sin disciplina` : ""),
      );
      await onChange();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function vincular() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/paradas/${paradaId}/vincular-ots`, { method: "POST" });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error al vincular");
        return;
      }
      const noEnc = data.noEncontradas as string[];
      setMsg(
        `Vinculadas ${data.vinculadas}` +
          (noEnc.length ? ` · sin OT en el sistema: ${noEnc.slice(0, 8).join(", ")}${noEnc.length > 8 ? "…" : ""}` : ""),
      );
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={seccion}>
      <h3 style={h3}>Importar y vincular OTs</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importar(file);
          }}
          style={{ fontSize: 13 }}
        />
        <button onClick={vincular} disabled={busy} style={btnSec}>
          Vincular con OTs del sistema
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "8px 0 0" }}>
        El Excel se parsea por nombre de columna. No se recrean OTs cuyo N° ya existe en la parada.
      </p>
      {msg && (
        <div style={{ fontSize: 12, marginTop: 8, color: msg.includes("Error") ? "#dc2626" : "#15803d" }}>{msg}</div>
      )}
    </div>
  );
}

/* ── Alta manual de OT ──────────────────────────────────────────────────── */
function SeccionOtManual({ paradaId, onChange }: { paradaId: string; onChange: () => Promise<void> }) {
  const vacio = {
    numeroOT: "",
    descripcion: "",
    disciplina: "ELEC" as DisciplinaParada,
    fase: "ejecucion" as "preparativos" | "ejecucion",
    hhEstimadas: "",
    fechaProg: "",
    grupo: "Dia" as "Dia" | "Noche" | "Ambos",
    critica: false,
  };
  const [f, setF] = useState(vacio);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function agregar() {
    if (!f.numeroOT.trim() || !f.descripcion.trim()) {
      setMsg("N° OT y descripción son obligatorios.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/paradas/${paradaId}/ots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numeroOT: f.numeroOT.trim(),
          descripcion: f.descripcion.trim(),
          disciplina: f.disciplina,
          fase: f.fase,
          hhEstimadas: Number(f.hhEstimadas) || 0,
          fechaProg: f.fechaProg || null,
          grupo: f.grupo,
          critica: f.critica,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error al agregar");
        return;
      }
      setMsg(`OT ${data.ot.numeroOT} agregada.`);
      setF(vacio);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={seccion}>
      <h3 style={h3}>Agregar OT manual</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={campo}>
          <span style={lbl}>N° OT</span>
          <input value={f.numeroOT} onChange={(e) => set("numeroOT", e.target.value)} style={inp} />
        </label>
        <label style={{ ...campo, flex: 1, minWidth: 200 }}>
          <span style={lbl}>Descripción</span>
          <input value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} style={inp} />
        </label>
        <label style={campo}>
          <span style={lbl}>Disciplina</span>
          <select value={f.disciplina} onChange={(e) => set("disciplina", e.target.value as DisciplinaParada)} style={inp}>
            {DISCIPLINAS.map((d) => (
              <option key={d} value={d}>{DISCIPLINA_LABEL[d]}</option>
            ))}
          </select>
        </label>
        <label style={campo}>
          <span style={lbl}>Fase</span>
          <select value={f.fase} onChange={(e) => set("fase", e.target.value as "preparativos" | "ejecucion")} style={inp}>
            <option value="preparativos">Preparativos</option>
            <option value="ejecucion">Ejecución</option>
          </select>
        </label>
        <label style={campo}>
          <span style={lbl}>HH est.</span>
          <input type="number" min={0} value={f.hhEstimadas} onChange={(e) => set("hhEstimadas", e.target.value)} style={inp} />
        </label>
        <label style={campo}>
          <span style={lbl}>F. programada</span>
          <input type="date" value={f.fechaProg} onChange={(e) => set("fechaProg", e.target.value)} style={inp} />
        </label>
        <label style={campo}>
          <span style={lbl}>Grupo</span>
          <select value={f.grupo} onChange={(e) => set("grupo", e.target.value as "Dia" | "Noche" | "Ambos")} style={inp}>
            <option value="Dia">Día</option>
            <option value="Noche">Noche</option>
            <option value="Ambos">Ambos</option>
          </select>
        </label>
        <label style={{ ...campo, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", paddingBottom: 6 }}>
          <input type="checkbox" checked={f.critica} onChange={(e) => set("critica", e.target.checked)} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Crítica</span>
        </label>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={agregar} disabled={busy} style={btnPrim}>
          {busy ? "Agregando…" : "Agregar OT"}
        </button>
        {msg && <span style={{ fontSize: 12, color: msg.includes("Error") || msg.includes("obligat") ? "#dc2626" : "#15803d" }}>{msg}</span>}
      </div>
    </div>
  );
}

/* ── Zona peligrosa ─────────────────────────────────────────────────────── */
function SeccionPeligro({ paradaId, codigo, onDeleted }: { paradaId: string; codigo: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);

  async function eliminar() {
    if (!confirm(`¿Eliminar la parada ${codigo}? Se borran sus OTs, grupos, avances y reportes. Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/paradas/${paradaId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok === false) {
        alert(data.error ?? "Error al eliminar");
        return;
      }
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...seccion, borderColor: "#fecaca", background: "#fef2f2" }}>
      <h3 style={{ ...h3, color: "#b91c1c" }}>Zona peligrosa</h3>
      <button
        onClick={eliminar}
        disabled={busy}
        style={{ ...btnPrim, background: "#dc2626" }}
      >
        {busy ? "Eliminando…" : "Eliminar parada"}
      </button>
    </div>
  );
}
