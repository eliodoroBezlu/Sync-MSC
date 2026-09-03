"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DisciplinaParada } from "@/lib/parada/tipos";
import { DISCIPLINAS_PARADA } from "@/lib/parada/tipos";
import type { SessionPayload } from "@/lib/auth";
import { generarInformeCierrePdf, type DatosInformeCierre } from "@/lib/parada/generarInformeCierrePdf";
import type {
  AvanceCli,
  EstadoParada,
  ParadaDetalle,
  ParadaGrupoCli,
  ParadaOtCli,
  TableroParada as TableroData,
  TurnoParada,
} from "./tipos";
import { ymdInput, DISCIPLINA_LABEL, inp, btnPrim, btnSec } from "./ui";

/** Técnico o contratista elegible para asignar a grupos y OTs de la parada. */
interface TecnicoOpt {
  _id: string;
  nombreCompleto: string;
  disciplina: string | null;
  esContratista: boolean;
}

/** Carga una sola vez la lista de técnicos + contratistas (rol 4 y 6). */
function useTecnicos(): TecnicoOpt[] {
  const [lista, setLista] = useState<TecnicoOpt[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch("/api/usuarios?rol=4,6")
      .then((r) => r.json())
      .then((data: Array<{ _id: string; nombreCompleto: string; disciplina: string | null; esContratista: boolean }>) => {
        if (vivo && Array.isArray(data)) {
          setLista(
            data.map((u) => ({
              _id: u._id,
              nombreCompleto: u.nombreCompleto,
              disciplina: u.disciplina ?? null,
              esContratista: !!u.esContratista,
            })),
          );
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  return lista;
}

interface Props {
  parada: ParadaDetalle;
  tablero: TableroData | null;
  puedeCerrar: boolean;
  usuario: SessionPayload;
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

export default function ConfigParada({ parada, tablero, puedeCerrar, usuario, onChange, onDeleted }: Props) {
  return (
    <div>
      <SeccionDatos parada={parada} onChange={onChange} />
      <SeccionGrupos parada={parada} onChange={onChange} />
      <SeccionAsignaciones parada={parada} onChange={onChange} />
      <SeccionImportar paradaId={parada.id} onChange={onChange} />
      <SeccionOtManual paradaId={parada.id} onChange={onChange} />
      <SeccionCierre parada={parada} tablero={tablero} puedeCerrar={puedeCerrar} usuario={usuario} onChange={onChange} />
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
  const tecnicos = useTecnicos();
  const porClave = useMemo(() => {
    const m = new Map<string, ParadaGrupoCli>();
    for (const g of parada.grupos) m.set(`${g.turno}|${g.disciplina}`, g);
    return m;
  }, [parada.grupos]);

  return (
    <div style={seccion}>
      <h3 style={h3}>Grupos, líderes y cuadrilla</h3>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
        Un grupo por turno y disciplina. El <b>supervisor</b> es el responsable del grupo; el <b>líder</b> es un
        técnico de la propia cuadrilla. «Dot. apoyo» es sólo un número de contratistas — no lleva nombres.
      </p>
      {TURNOS.map((turno) => (
        <div key={turno} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#ea580c", marginBottom: 8 }}>
            Turno {turno === "Dia" ? "Día" : "Noche"}
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {DISCIPLINAS.map((disc) => (
              <TarjetaGrupo
                key={disc}
                paradaId={parada.id}
                turno={turno}
                disciplina={disc}
                grupo={porClave.get(`${turno}|${disc}`) ?? null}
                tecnicos={tecnicos}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TarjetaGrupo({
  paradaId, turno, disciplina, grupo, tecnicos, onChange,
}: {
  paradaId: string;
  turno: TurnoParada;
  disciplina: DisciplinaParada;
  grupo: ParadaGrupoCli | null;
  tecnicos: TecnicoOpt[];
  onChange: () => Promise<void>;
}) {
  const [f, setF] = useState({
    supervisorNombre: grupo?.supervisorNombre ?? "",
    dotacionPropia: String(grupo?.dotacionPropia ?? ""),
    dotacionApoyo: String(grupo?.dotacionApoyo ?? ""),
  });
  const [seleccion, setSeleccion] = useState<Set<string>>(
    () => new Set((grupo?.miembros ?? []).map((m) => m.usuarioId).filter((x): x is string => !!x)),
  );
  const [liderId, setLiderId] = useState<string>(
    () => (grupo?.miembros ?? []).find((m) => m.esLider)?.usuarioId ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Ordena: la disciplina del técnico primero, contratistas al final.
  const orden = useMemo(() => {
    const disc = disciplina as string;
    return [...tecnicos].sort((a, b) => {
      const am = a.disciplina === disc ? 0 : 1;
      const bm = b.disciplina === disc ? 0 : 1;
      if (am !== bm) return am - bm;
      if (a.esContratista !== b.esContratista) return a.esContratista ? 1 : -1;
      return a.nombreCompleto.localeCompare(b.nombreCompleto);
    });
  }, [tecnicos, disciplina]);

  function toggle(id: string) {
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        if (liderId === id) setLiderId("");
      } else {
        n.add(id);
      }
      return n;
    });
  }

  async function guardar() {
    setBusy(true);
    setMsg("");
    try {
      const miembros = orden
        .filter((t) => seleccion.has(t._id))
        .map((t) => ({ usuarioId: t._id, nombre: t.nombreCompleto, esLider: t._id === liderId }));
      const res = await fetch(`/api/paradas/${paradaId}/grupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turno,
          disciplina,
          supervisorNombre: f.supervisorNombre,
          dotacionPropia: Number(f.dotacionPropia) || 0,
          dotacionApoyo: Number(f.dotacionApoyo) || 0,
          miembros,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error");
        return;
      }
      setMsg("Guardado.");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  const seleccionados = orden.filter((t) => seleccion.has(t._id));

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#0f2847" }}>
        {DISCIPLINA_LABEL[disciplina]}{" "}
        <span style={{ fontWeight: 600, color: "#94a3b8" }}>· {seleccionados.length} en cuadrilla</span>
      </div>

      <label style={campo}>
        <span style={lbl}>Supervisor</span>
        <input value={f.supervisorNombre} onChange={(e) => set("supervisorNombre", e.target.value)} style={inp} placeholder="Nombre del supervisor" />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ ...campo, minWidth: 0, flex: 1 }}>
          <span style={lbl}>Dot. propia</span>
          <input type="number" min={0} value={f.dotacionPropia} onChange={(e) => set("dotacionPropia", e.target.value)} style={inp} />
        </label>
        <label style={{ ...campo, minWidth: 0, flex: 1 }}>
          <span style={lbl}>Dot. apoyo</span>
          <input type="number" min={0} value={f.dotacionApoyo} onChange={(e) => set("dotacionApoyo", e.target.value)} style={inp} />
        </label>
      </div>

      <div>
        <span style={lbl}>Cuadrilla (técnicos)</span>
        <div style={{ maxHeight: 168, overflowY: "auto", border: "1.5px solid #e2e8f0", borderRadius: 6, padding: 6, marginTop: 3 }}>
          {orden.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>Cargando técnicos…</div>}
          {orden.map((t) => (
            <label key={t._id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={seleccion.has(t._id)} onChange={() => toggle(t._id)} />
              <span style={{ color: t.disciplina === disciplina ? "#0f2847" : "#64748b" }}>
                {t.nombreCompleto}
                {t.esContratista && <span style={{ color: "#ea580c" }}> · contratista</span>}
              </span>
            </label>
          ))}
        </div>
      </div>

      <label style={campo}>
        <span style={lbl}>Líder del grupo</span>
        <select value={liderId} onChange={(e) => setLiderId(e.target.value)} style={inp}>
          <option value="">— sin líder —</option>
          {seleccionados.map((t) => (
            <option key={t._id} value={t._id}>{t.nombreCompleto}</option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={guardar} disabled={busy} style={{ ...btnSec, padding: "6px 12px" }}>
          {busy ? "Guardando…" : grupo ? "Actualizar grupo" : "Crear grupo"}
        </button>
        {msg && <span style={{ fontSize: 11, color: msg === "Guardado." ? "#15803d" : "#dc2626" }}>{msg}</span>}
      </div>
    </div>
  );
}

/* ── Asignar técnicos a las OTs de la parada ────────────────────────────── */
function SeccionAsignaciones({ parada, onChange }: { parada: ParadaDetalle; onChange: () => Promise<void> }) {
  const tecnicos = useTecnicos();
  const porDisc = useMemo(() => {
    const m = new Map<string, ParadaOtCli[]>();
    for (const ot of parada.ots) {
      const arr = m.get(ot.disciplina) ?? [];
      arr.push(ot);
      m.set(ot.disciplina, arr);
    }
    return m;
  }, [parada.ots]);

  if (parada.ots.length === 0) {
    return (
      <div style={seccion}>
        <h3 style={h3}>Asignar técnicos a las OTs</h3>
        <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
          Primero importá o agregá OTs a la parada; después asignás quién ejecuta y reporta cada una.
        </p>
      </div>
    );
  }

  return (
    <div style={seccion}>
      <h3 style={h3}>Asignar técnicos a las OTs</h3>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
        Los técnicos asignados verán la OT en <b>Registro de OT</b> bajo el código de la parada y la abrirán/cerrarán
        desde ahí.
      </p>
      {DISCIPLINAS.map((disc) => {
        const ots = porDisc.get(disc) ?? [];
        if (ots.length === 0) return null;
        return (
          <div key={disc} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#ea580c", marginBottom: 6 }}>
              {DISCIPLINA_LABEL[disc]} · {ots.length} OT
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ots.map((ot) => (
                <FilaAsignacionOt
                  key={ot.id}
                  paradaId={parada.id}
                  ot={ot}
                  tecnicos={tecnicos.filter((t) => t.disciplina === disc || t.disciplina == null || t.esContratista)}
                  onChange={onChange}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilaAsignacionOt({
  paradaId, ot, tecnicos, onChange,
}: {
  paradaId: string;
  ot: ParadaOtCli;
  tecnicos: TecnicoOpt[];
  onChange: () => Promise<void>;
}) {
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(ot.personalAsignadoIds ?? []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [abierto, setAbierto] = useState(false);

  const orden = useMemo(
    () => [...tecnicos].sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto)),
    [tecnicos],
  );
  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of orden) m.set(t._id, t.nombreCompleto);
    return m;
  }, [orden]);

  function toggle(id: string) {
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function guardar() {
    setBusy(true);
    setMsg("");
    try {
      const ids = orden.filter((t) => seleccion.has(t._id)).map((t) => t._id);
      const nombres = ids.map((id) => nombrePorId.get(id) ?? "").filter(Boolean);
      const res = await fetch(`/api/paradas/${paradaId}/ots/${ot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalAsignadoIds: ids, personalAsignado: nombres }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error");
        return;
      }
      setMsg("Guardado.");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  const asignadosLabel =
    ot.personalAsignado.length > 0 ? ot.personalAsignado.join(", ") : "Sin asignar";

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>{ot.numeroOT}</span>
        <span style={{ fontSize: 12, color: "#64748b" }}>{ot.tag || "—"}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#ea580c" }}>{ot.grupo}</span>
        <span style={{ fontSize: 12, color: "#334155", flex: 1, minWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ot.descripcion}
        </span>
        <button onClick={() => setAbierto((v) => !v)} style={{ ...btnSec, padding: "4px 10px" }}>
          {abierto ? "Cerrar" : "Asignar"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: seleccion.size > 0 || ot.personalAsignado.length > 0 ? "#15803d" : "#94a3b8", marginTop: 3 }}>
        {asignadosLabel}
      </div>
      {abierto && (
        <div style={{ marginTop: 8 }}>
          <div style={{ maxHeight: 168, overflowY: "auto", border: "1.5px solid #e2e8f0", borderRadius: 6, padding: 6 }}>
            {orden.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>Cargando técnicos…</div>}
            {orden.map((t) => (
              <label key={t._id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={seleccion.has(t._id)} onChange={() => toggle(t._id)} />
                <span>
                  {t.nombreCompleto}
                  {t.esContratista && <span style={{ color: "#ea580c" }}> · contratista</span>}
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <button onClick={guardar} disabled={busy} style={{ ...btnSec, padding: "6px 12px" }}>
              {busy ? "Guardando…" : "Guardar asignación"}
            </button>
            {msg && <span style={{ fontSize: 11, color: msg === "Guardado." ? "#15803d" : "#dc2626" }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
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
          (data.sinDisciplina ? ` · ${data.sinDisciplina} sin disciplina` : "") +
          (data.seccionesOmitidas ? ` · ${data.seccionesOmitidas} filas de agrupación` : ""),
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
        El Excel se parsea por nombre de columna y se leen todas las hojas (una por disciplina).
        Las filas de agrupación se descartan y no se recrean OTs cuyo N° ya existe en la parada.
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

/* ── Cierre de la parada ───────────────────────────────────────────────── */
function SeccionCierre({
  parada, tablero, puedeCerrar, usuario, onChange,
}: {
  parada: ParadaDetalle;
  tablero: TableroData | null;
  puedeCerrar: boolean;
  usuario: SessionPayload;
  onChange: () => Promise<void>;
}) {
  const cerrada = parada.estado === "cerrada";
  const [notas, setNotas] = useState({
    leccionesAprendidas: parada.leccionesAprendidas ?? "",
    observacionesCierre: parada.observacionesCierre ?? "",
  });
  const [busy, setBusy] = useState<"" | "notas" | "cerrar" | "reabrir" | "pdf">("");
  const [msg, setMsg] = useState("");

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/paradas/${parada.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok === false) {
      setMsg(data.error ?? "Error al guardar");
      return false;
    }
    return true;
  }

  async function guardarNotas() {
    setBusy("notas");
    setMsg("");
    try {
      const ok = await patch({
        leccionesAprendidas: notas.leccionesAprendidas || null,
        observacionesCierre: notas.observacionesCierre || null,
      });
      if (ok) {
        setMsg("Notas de cierre guardadas.");
        await onChange();
      }
    } finally {
      setBusy("");
    }
  }

  async function cerrar() {
    if (!confirm(`¿Cerrar la parada ${parada.codigo}? Se bloquea el registro de avances y reportes. Podrás reabrirla si hace falta.`)) return;
    setBusy("cerrar");
    setMsg("");
    try {
      if (await patch({ estado: "cerrada", fechaCierre: new Date().toISOString() })) {
        setMsg("Parada cerrada.");
        await onChange();
      }
    } finally {
      setBusy("");
    }
  }

  async function reabrir() {
    if (!confirm(`¿Reabrir la parada ${parada.codigo}? Vuelve al estado «En ejecución».`)) return;
    setBusy("reabrir");
    setMsg("");
    try {
      if (await patch({ estado: "ejecucion", fechaCierre: null })) {
        setMsg("Parada reabierta.");
        await onChange();
      }
    } finally {
      setBusy("");
    }
  }

  async function generarPdf() {
    setBusy("pdf");
    setMsg("");
    try {
      const res = await fetch(`/api/paradas/${parada.id}/avances`);
      const avances: AvanceCli[] = res.ok ? await res.json() : [];
      const hhPorOt = new Map<string, number>();
      for (const a of avances) {
        hhPorOt.set(a.paradaOtId, (hhPorOt.get(a.paradaOtId) ?? 0) + a.hhPropias + a.hhApoyo);
      }
      const otsEjec = parada.ots.filter((o) => o.fase === "ejecucion");
      const emitidos = parada.reportesDiarios.filter((r) => r.estado === "emitido");

      const retrasosMap = new Map<string, { numeroOT: string; motivo: string; accion: string }>();
      for (const r of emitidos) {
        for (const x of r.otsConRetraso ?? []) {
          if (!retrasosMap.has(x.numeroOT)) {
            retrasosMap.set(x.numeroOT, { numeroOT: x.numeroOT, motivo: x.motivo, accion: x.accion });
          }
        }
      }
      const pendMap = new Map<string, { tipo: string; detalle: string }>();
      for (const r of emitidos) {
        for (const p of r.pendientes ?? []) {
          const k = `${p.tipo}|${p.detalle}`;
          if (!pendMap.has(k)) pendMap.set(k, { tipo: p.tipo, detalle: p.detalle });
        }
      }

      const porDisciplina = tablero
        ? DISCIPLINAS_PARADA.map((d) => ({ disciplina: d, ...tablero.porDisciplina[d] })).filter((x) => x.otsTotal > 0)
        : [];

      const datos: DatosInformeCierre = {
        paradaCodigo: parada.codigo,
        paradaNombre: parada.nombre,
        planta: parada.planta,
        fechaPreparativosInicio: parada.fechaPreparativosInicio,
        fechaEjecucionInicio: parada.fechaEjecucionInicio,
        fechaEjecucionFin: parada.fechaEjecucionFin,
        fechaCierre: parada.fechaCierre,
        estado: parada.estado,
        avanceGlobalPct: tablero?.avanceGlobalPct ?? 0,
        cumplimientoPct: Math.round((tablero?.cumplimientoHoy ?? 0) * 100),
        otsEjecucion: {
          total: tablero?.ots.ejecucion.total ?? otsEjec.length,
          terminadas: tablero?.ots.ejecucion.terminadas ?? 0,
          enEjecucion: tablero?.ots.ejecucion.enEjecucion ?? 0,
          noIniciadas: tablero?.ots.ejecucion.noIniciadas ?? 0,
          conRetraso: tablero?.ots.ejecucion.conRetraso ?? 0,
        },
        otsPreparativos: {
          total: tablero?.ots.preparativos.total ?? 0,
          terminadas: tablero?.ots.preparativos.terminadas ?? 0,
        },
        hh: {
          hhEst: tablero?.hh.hhEst ?? 0,
          hhReal: tablero?.hh.hhReal ?? 0,
          factorProductividad: tablero?.hh.factorProductividad ?? 0,
        },
        porDisciplina,
        serieDiaria: tablero?.serieDiaria ?? [],
        detalleOts: otsEjec.map((o) => ({
          numeroOT: o.numeroOT,
          descripcion: o.descripcion,
          disciplina: o.disciplina,
          grupo: o.grupo,
          hhEst: o.hhEstimadas,
          hhReal: Math.round((hhPorOt.get(o.id) ?? 0) * 10) / 10,
          avancePct: o.avancePct,
          estado: o.estado,
        })),
        otsPendientes: otsEjec
          .filter((o) => o.estado !== "terminada")
          .map((o) => ({
            numeroOT: o.numeroOT,
            descripcion: o.descripcion,
            disciplina: o.disciplina,
            avancePct: o.avancePct,
            estado: o.estado,
          })),
        retrasosReportados: [...retrasosMap.values()],
        pendientesReportados: [...pendMap.values()],
        leccionesAprendidas: notas.leccionesAprendidas,
        observacionesCierre: notas.observacionesCierre,
        generadoPor: usuario.nombre || usuario.email || "—",
      };
      generarInformeCierrePdf(datos);
    } finally {
      setBusy("");
    }
  }

  const ta: React.CSSProperties = { ...inp, minHeight: 76, resize: "vertical", fontFamily: "inherit" };

  return (
    <div style={{ ...seccion, borderColor: cerrada ? "#bbf7d0" : "#e2e8f0", background: cerrada ? "#f0fdf4" : undefined }}>
      <h3 style={h3}>Cierre de la parada</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
        <label style={{ ...campo, minWidth: 0 }}>
          <span style={lbl}>Lecciones aprendidas</span>
          <textarea
            value={notas.leccionesAprendidas}
            onChange={(e) => setNotas((p) => ({ ...p, leccionesAprendidas: e.target.value }))}
            style={ta}
            placeholder="Qué salió bien, qué mejorar para la próxima parada…"
          />
        </label>
        <label style={{ ...campo, minWidth: 0 }}>
          <span style={lbl}>Observaciones de cierre</span>
          <textarea
            value={notas.observacionesCierre}
            onChange={(e) => setNotas((p) => ({ ...p, observacionesCierre: e.target.value }))}
            style={ta}
            placeholder="Pendientes trasladados a operación / mantenimiento normal, acuerdos…"
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={guardarNotas} disabled={busy !== ""} style={btnSec}>
          {busy === "notas" ? "Guardando…" : "Guardar notas de cierre"}
        </button>
        <button onClick={generarPdf} disabled={busy !== ""} style={btnPrim}>
          {busy === "pdf" ? "Generando…" : "Generar informe de cierre (PDF)"}
        </button>
        {puedeCerrar && !cerrada && (
          <button onClick={cerrar} disabled={busy !== ""} style={{ ...btnPrim, background: "#16a34a" }}>
            {busy === "cerrar" ? "Cerrando…" : "Cerrar parada"}
          </button>
        )}
        {puedeCerrar && cerrada && (
          <button onClick={reabrir} disabled={busy !== ""} style={{ ...btnSec, borderColor: "#f59e0b", color: "#b45309" }}>
            {busy === "reabrir" ? "Reabriendo…" : "Reabrir parada"}
          </button>
        )}
        {msg && <span style={{ fontSize: 12, color: msg.includes("Error") ? "#dc2626" : "#15803d" }}>{msg}</span>}
      </div>
      {cerrada && parada.fechaCierre && (
        <p style={{ fontSize: 12, color: "#15803d", margin: "10px 0 0", fontWeight: 700 }}>
          Parada cerrada el {new Date(parada.fechaCierre).toLocaleDateString("es-BO")}.
        </p>
      )}
      {!puedeCerrar && (
        <p style={{ fontSize: 11, color: "#94a3b8", margin: "8px 0 0" }}>
          Sólo Admin y Superintendente pueden cerrar o reabrir la parada.
        </p>
      )}
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
