"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DisciplinaParada } from "@/lib/parada/tipos";
import type {
  EstadoParada,
  ParadaDetalle,
  ParadaGrupoCli,
  ParadaOtCli,
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

/** Supervisor (rol 3) elegible como responsable de un grupo. */
interface SupervisorOpt {
  _id: string;
  nombreCompleto: string;
  disciplina: string | null;
}

/** Carga una sola vez la lista de supervisores (rol 3). */
function useSupervisores(): SupervisorOpt[] {
  const [lista, setLista] = useState<SupervisorOpt[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch("/api/usuarios?rol=3")
      .then((r) => r.json())
      .then((data: Array<{ _id: string; nombreCompleto: string; disciplina: string | null }>) => {
        if (vivo && Array.isArray(data)) {
          setLista(
            data.map((u) => ({
              _id: u._id,
              nombreCompleto: u.nombreCompleto,
              disciplina: u.disciplina ?? null,
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
  onChange: () => Promise<void>;
  onDeleted: () => void;
  /** Supervisores (rol 3): sólo ven/editan Grupos y Asignaciones. */
  soloGrupos?: boolean;
  /** Si el usuario es supervisor/técnico, disciplina a la que queda restringido (null = ve todo). */
  discFiltro?: DisciplinaParada | null;
}

const DISCIPLINAS: DisciplinaParada[] = ["ELEC", "INST", "TESA"];
const TURNOS: TurnoParada[] = ["Dia", "Noche"];

const rid = () => Math.random().toString(36).slice(2);

const seccion: React.CSSProperties = {
  border: "1.5px solid #e2e8f0",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const h3: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: "#0f2847", margin: "0 0 12px" };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" };
const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, minWidth: 130 };

export default function ConfigParada({
  parada,
  onChange,
  onDeleted,
  soloGrupos = false,
  discFiltro = null,
}: Props) {
  if (soloGrupos) {
    return (
      <div>
        <SeccionGrupos parada={parada} onChange={onChange} discFiltro={discFiltro} />
        <SeccionAsignaciones parada={parada} onChange={onChange} discFiltro={discFiltro} />
      </div>
    );
  }
  return (
    <div>
      <SeccionDatos parada={parada} onChange={onChange} />
      <SeccionGrupos parada={parada} onChange={onChange} discFiltro={discFiltro} />
      <SeccionAsignaciones parada={parada} onChange={onChange} discFiltro={discFiltro} />
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

/* ── Grupos (acordeón, filtrado por disciplina) ─────────────────────────── */
function SeccionGrupos({
  parada,
  onChange,
  discFiltro,
}: {
  parada: ParadaDetalle;
  onChange: () => Promise<void>;
  discFiltro: DisciplinaParada | null;
}) {
  const supervisores = useSupervisores();
  const [turnoAct, setTurnoAct] = useState<TurnoParada>("Dia");
  const [creando, setCreando] = useState("");

  const discsVisibles = discFiltro ? [discFiltro] : DISCIPLINAS;

  // Roster de la parada por disciplina: los técnicos que ya están en algún
  // grupo de esa disciplina (los que se cargaron del Excel). De acá sale la
  // lista para elegir — no de los ~200 usuarios del sistema.
  const rosterPorDisc = useMemo(() => {
    const m = new Map<string, { usuarioId: string; nombre: string }[]>();
    for (const g of parada.grupos) {
      const arr = m.get(g.disciplina) ?? [];
      for (const mi of g.miembros ?? []) {
        if (mi.usuarioId && !arr.some((x) => x.usuarioId === mi.usuarioId)) {
          arr.push({ usuarioId: mi.usuarioId, nombre: mi.nombre });
        }
      }
      m.set(g.disciplina, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return m;
  }, [parada.grupos]);

  // Grupos existentes agrupados por `${turno}|${disciplina}`, ordenados por número.
  const porTurnoDisc = useMemo(() => {
    const m = new Map<string, ParadaGrupoCli[]>();
    for (const g of parada.grupos) {
      const k = `${g.turno}|${g.disciplina}`;
      const arr = m.get(k) ?? [];
      arr.push(g);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.numero - b.numero);
    return m;
  }, [parada.grupos]);

  async function agregarGrupo(turno: TurnoParada, disc: DisciplinaParada) {
    const k = `${turno}|${disc}`;
    const existentes = porTurnoDisc.get(k) ?? [];
    const numero = existentes.reduce((mx, g) => Math.max(mx, g.numero), 0) + 1;
    setCreando(k);
    try {
      await fetch(`/api/paradas/${parada.id}/grupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turno, disciplina: disc, numero, supervisorNombre: "" }),
      });
      await onChange();
    } finally {
      setCreando("");
    }
  }

  return (
    <div style={seccion}>
      <h3 style={h3}>Grupos</h3>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
        Elegí el turno, tocá un grupo para abrirlo y ahí asignás supervisor, técnicos y personal de apoyo.
        {discFiltro && ` Sólo ves los grupos de ${DISCIPLINA_LABEL[discFiltro]}.`}
      </p>

      {/* Selector de turno */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {TURNOS.map((t) => (
          <button
            key={t}
            onClick={() => setTurnoAct(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              border: "1.5px solid #e2e8f0",
              background: turnoAct === t ? "#0f2847" : "white",
              color: turnoAct === t ? "white" : "#334155",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Turno {t === "Dia" ? "Día" : "Noche"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {discsVisibles.map((disc) => {
          const k = `${turnoAct}|${disc}`;
          const grupos = porTurnoDisc.get(k) ?? [];
          return (
            <div key={disc}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f2847", marginBottom: 8 }}>
                {DISCIPLINA_LABEL[disc]}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {grupos.map((g) => (
                  <TarjetaGrupoAccordion
                    key={g.id}
                    paradaId={parada.id}
                    turno={turnoAct}
                    disciplina={disc}
                    grupo={g}
                    supervisores={supervisores}
                    rosterDisc={rosterPorDisc.get(disc) ?? []}
                    onChange={onChange}
                  />
                ))}
                {grupos.length === 0 && (
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    Sin grupos de {turnoAct === "Dia" ? "día" : "noche"} en {DISCIPLINA_LABEL[disc]}.
                  </div>
                )}
                <button
                  onClick={() => agregarGrupo(turnoAct, disc)}
                  disabled={creando === k}
                  style={{ ...btnSec, padding: "6px 12px", alignSelf: "flex-start" }}
                >
                  {creando === k ? "Agregando…" : "+ Agregar grupo"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TarjetaGrupoAccordion({
  paradaId,
  turno,
  disciplina,
  grupo,
  supervisores,
  rosterDisc,
  onChange,
}: {
  paradaId: string;
  turno: TurnoParada;
  disciplina: DisciplinaParada;
  grupo: ParadaGrupoCli;
  supervisores: SupervisorOpt[];
  rosterDisc: { usuarioId: string; nombre: string }[];
  onChange: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [supUsuarioId, setSupUsuarioId] = useState(grupo.supervisorUsuarioId ?? "");
  const [supNombre, setSupNombre] = useState(grupo.supervisorNombre ?? "");

  // Técnicos propios del grupo: usuarioId -> nombre.
  const [propios, setPropios] = useState<Map<string, string>>(
    () =>
      new Map(
        (grupo.miembros ?? [])
          .filter((m) => !!m.usuarioId)
          .map((m) => [m.usuarioId as string, m.nombre]),
      ),
  );
  // Personal de apoyo (contratistas) con nombre: se guardan como miembros sin usuarioId.
  const [apoyo, setApoyo] = useState<{ key: string; nombre: string }[]>(
    () =>
      (grupo.miembros ?? [])
        .filter((m) => !m.usuarioId)
        .map((m) => ({ key: rid(), nombre: m.nombre })),
  );
  // Apoyo del que todavía no se tiene el nombre — sólo cuenta.
  const apoyoNombradoInicial = (grupo.miembros ?? []).filter((m) => !m.usuarioId).length;
  const [apoyoSinNombre, setApoyoSinNombre] = useState<string>(
    String(Math.max(0, (grupo.dotacionApoyo ?? 0) - apoyoNombradoInicial) || ""),
  );
  // Personas creadas con «Persona nueva» en esta sesión (para que aparezcan en la lista).
  const [extra, setExtra] = useState<{ usuarioId: string; nombre: string }[]>([]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const marcar = () => {
    setDirty(true);
    setMsg("");
  };

  // Lista para elegir: roster de la disciplina + ya seleccionados + nuevos de esta sesión.
  const candidatos = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of rosterDisc) m.set(t.usuarioId, t.nombre);
    for (const [id, nom] of propios) if (!m.has(id)) m.set(id, nom);
    for (const t of extra) if (!m.has(t.usuarioId)) m.set(t.usuarioId, t.nombre);
    return [...m.entries()]
      .map(([usuarioId, nombre]) => ({ usuarioId, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [rosterDisc, propios, extra]);

  // Supervisores de la disciplina; si no hay ninguno, todos. Incluye el ya guardado.
  const supsDisc = useMemo(() => {
    const propiosSup = supervisores.filter((s) => s.disciplina === disciplina);
    const base = propiosSup.length > 0 ? propiosSup : supervisores;
    if (supUsuarioId && !base.some((s) => s._id === supUsuarioId)) {
      return [
        ...base,
        { _id: supUsuarioId, nombreCompleto: supNombre || "(supervisor)", disciplina: null },
      ];
    }
    return base;
  }, [supervisores, disciplina, supUsuarioId, supNombre]);

  const apoyoTotal = apoyo.filter((a) => a.nombre.trim()).length + (Number(apoyoSinNombre) || 0);

  function toggleTecnico(id: string, nombre: string) {
    setPropios((prev) => {
      const n = new Map(prev);
      if (n.has(id)) n.delete(id);
      else n.set(id, nombre);
      return n;
    });
    marcar();
  }

  function elegirSupervisor(id: string) {
    const s = supervisores.find((x) => x._id === id);
    setSupUsuarioId(id);
    setSupNombre(s?.nombreCompleto ?? "");
    marcar();
  }

  async function personaNueva() {
    const nombre = window
      .prompt(`Nombre de la persona nueva para ${DISCIPLINA_LABEL[disciplina]}:`)
      ?.trim();
    if (!nombre) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, rol: 4, disciplina, esContratista: false, activo: true }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setMsg(data.error ?? "No se pudo crear la persona");
        return;
      }
      const usuarioId: string = data._id;
      setExtra((p) => [...p, { usuarioId, nombre }]);
      setPropios((prev) => new Map(prev).set(usuarioId, nombre));
      setDirty(true);
    } finally {
      setBusy(false);
    }
  }

  function setApoyoAt(key: string, v: string) {
    setApoyo((p) => p.map((x) => (x.key === key ? { ...x, nombre: v } : x)));
    marcar();
  }
  function quitarApoyo(key: string) {
    setApoyo((p) => p.filter((x) => x.key !== key));
    marcar();
  }
  function agregarApoyo() {
    setApoyo((p) => [...p, { key: rid(), nombre: "" }]);
    marcar();
  }

  async function guardar() {
    setBusy(true);
    setMsg("");
    try {
      const apoyoLimpio = apoyo.map((a) => a.nombre.trim()).filter(Boolean);
      const miembros = [
        ...[...propios.entries()].map(([usuarioId, nombre]) => ({ usuarioId, nombre, esLider: false })),
        ...apoyoLimpio.map((nombre) => ({ usuarioId: null, nombre, esLider: false })),
      ];
      const res = await fetch(`/api/paradas/${paradaId}/grupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turno,
          disciplina,
          numero: grupo.numero,
          supervisorNombre: supNombre,
          supervisorUsuarioId: supUsuarioId || null,
          dotacionPropia: propios.size,
          dotacionApoyo: apoyoLimpio.length + (Number(apoyoSinNombre) || 0),
          miembros,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error");
        return;
      }
      setApoyo(apoyoLimpio.map((nombre) => ({ key: rid(), nombre })));
      setExtra([]);
      setDirty(false);
      setMsg("Guardado.");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function eliminar(e: React.MouseEvent) {
    e.stopPropagation();
    const etiqueta = `Grupo ${grupo.numero} de ${DISCIPLINA_LABEL[disciplina]} (${turno === "Dia" ? "Día" : "Noche"})`;
    if (!confirm(`¿Eliminar el ${etiqueta}?`)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/paradas/${paradaId}/grupos/${grupo.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok === false) {
        setMsg(data.error ?? "Error");
        return;
      }
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
      {/* Cabecera / resumen — clic para desplegar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setAbierto((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAbierto((v) => !v);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          cursor: "pointer",
          background: abierto ? "#f8fafc" : "white",
        }}
      >
        <span style={{ fontSize: 12, color: "#94a3b8", width: 12 }}>{abierto ? "▾" : "▸"}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#0f2847", whiteSpace: "nowrap" }}>
          Grupo {grupo.numero}
        </span>
        <span
          style={{
            fontSize: 12,
            color: supNombre ? "#334155" : "#94a3b8",
            flex: 1,
            minWidth: 60,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {supNombre || "sin supervisor"}
        </span>
        <span style={{ fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>
          👷 {propios.size}&nbsp;&nbsp;🤝 {apoyoTotal}
        </span>
        {dirty && (
          <span
            title="Cambios sin guardar"
            style={{ width: 8, height: 8, borderRadius: 4, background: "#ea580c", flexShrink: 0 }}
          />
        )}
        <button
          onClick={eliminar}
          disabled={busy}
          title="Eliminar grupo"
          style={{ ...btnSec, padding: "2px 8px", color: "#dc2626", borderColor: "#fecaca", flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      {abierto && (
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            borderTop: "1.5px solid #e2e8f0",
          }}
        >
          <label style={campo}>
            <span style={lbl}>Supervisor</span>
            <select value={supUsuarioId} onChange={(e) => elegirSupervisor(e.target.value)} style={inp}>
              <option value="">— sin asignar —</option>
              {supsDisc.map((s) => (
                <option key={s._id} value={s._id}>{s.nombreCompleto}</option>
              ))}
            </select>
          </label>

          {/* Técnicos */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={lbl}>Técnicos · {propios.size}</span>
              <button
                onClick={personaNueva}
                disabled={busy}
                style={{ ...btnSec, padding: "3px 10px", fontSize: 12 }}
              >
                ＋ Persona nueva
              </button>
            </div>
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1.5px solid #e2e8f0", borderRadius: 6, padding: 6 }}>
              {candidatos.length === 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Sin técnicos en el roster de esta disciplina. Usá «Persona nueva».
                </div>
              )}
              {candidatos.map((t) => (
                <label
                  key={t.usuarioId}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={propios.has(t.usuarioId)}
                    onChange={() => toggleTecnico(t.usuarioId, t.nombre)}
                  />
                  <span style={{ color: "#0f2847" }}>{t.nombre}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Personal de apoyo */}
          <div>
            <span style={lbl}>Personal de apoyo (contratistas)</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 3 }}>
              {apoyo.length === 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Sin nombres de apoyo cargados.</div>
              )}
              {apoyo.map((a) => (
                <div key={a.key} style={{ display: "flex", gap: 6 }}>
                  <input
                    value={a.nombre}
                    onChange={(e) => setApoyoAt(a.key, e.target.value)}
                    placeholder="Nombre y apellido"
                    style={{ ...inp, flex: 1 }}
                  />
                  <button
                    onClick={() => quitarApoyo(a.key)}
                    title="Quitar"
                    style={{ ...btnSec, padding: "2px 10px", color: "#dc2626", borderColor: "#fecaca" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button onClick={agregarApoyo} style={{ ...btnSec, padding: "6px 12px" }}>
                  ＋ Agregar apoyo
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
                  o cantidad sin nombre:
                  <input
                    type="number"
                    min={0}
                    value={apoyoSinNombre}
                    onChange={(e) => {
                      setApoyoSinNombre(e.target.value);
                      marcar();
                    }}
                    style={{ ...inp, width: 70 }}
                  />
                </label>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={guardar}
              disabled={busy || !dirty}
              style={{ ...btnPrim, opacity: busy || !dirty ? 0.6 : 1 }}
            >
              {busy ? "Guardando…" : "Guardar grupo"}
            </button>
            {msg && (
              <span style={{ fontSize: 11, color: msg === "Guardado." ? "#15803d" : "#dc2626" }}>{msg}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Asignar técnicos a las OTs de la parada ────────────────────────────── */
function SeccionAsignaciones({
  parada,
  onChange,
  discFiltro,
}: {
  parada: ParadaDetalle;
  onChange: () => Promise<void>;
  discFiltro: DisciplinaParada | null;
}) {
  const tecnicos = useTecnicos();
  const discsVisibles = discFiltro ? [discFiltro] : DISCIPLINAS;
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
      {discsVisibles.map((disc) => {
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
        {ot.grupoNumero != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#0f2847", borderRadius: 5, padding: "1px 6px" }}>
            G{ot.grupoNumero}
          </span>
        )}
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
          (data.gruposCreados ? ` · ${data.gruposCreados} cuadrillas creadas` : "") +
          (data.cuadrillasBackfill ? ` · ${data.cuadrillasBackfill} OTs vinculadas a su cuadrilla` : "") +
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
