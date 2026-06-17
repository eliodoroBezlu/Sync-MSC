"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser, puedeVerSemanales } from "@/context/AuthContext";
import {
  IProgramacionSemanal, IOTProgramada, DiaSemana,
  GrupoTrabajo, EstadoOTProgramada, IArea,
} from "@/types";

// ─── Constantes ───────────────────────────────────────────────────────────────
const DIAS: DiaSemana[] = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];
const DIAS_FULL: Record<DiaSemana, string> = {
  Lu: "Lunes", Ma: "Martes", Mi: "Miércoles", Ju: "Jueves",
  Vi: "Viernes", Sa: "Sábado", Do: "Domingo",
};
const DIAS_CORTO: Record<DiaSemana, string> = {
  Lu: "LUN", Ma: "MAR", Mi: "MIE", Ju: "JUE",
  Vi: "VIE", Sa: "SAB", Do: "DOM",
};
const GRUPOS: GrupoTrabajo[] = ["G1", "G2", "G3", "G4", "Diurno", "Nocturno"];
const AREAS_SEMANAL = new Set(["3310","3311","3312","3313","3315","3316","3318","3319","3320","3322","3338","3339","3343","3348","3351","3388"]);

// Mapeo de areaCodigo → disciplina en MongoDB
function areaToDisciplina(areaCodigo: string): string {
  if (areaCodigo === "3320") return "INST";
  if (areaCodigo === "3319") return "ELEC";
  if (areaCodigo === "3348") return "TESA";
  if (areaCodigo === "3351") return "TELECO";
  return "MEC";
}

const ESTADO_COLOR: Record<EstadoOTProgramada, string> = {
  no_iniciada:  "bg-gray-100 text-gray-600 border-gray-200",
  en_proceso:   "bg-blue-50 text-blue-700 border-blue-200",
  en_revision:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  completada:   "bg-green-50 text-green-700 border-green-200",
  pendiente:    "bg-orange-50 text-orange-700 border-orange-200",
  atrasada:     "bg-red-50 text-red-700 border-red-200",
  bloqueada:    "bg-purple-50 text-purple-700 border-purple-200",
  cancelada:    "bg-gray-100 text-gray-400 border-gray-200 line-through",
};
const ESTADO_BADGE: Record<EstadoOTProgramada, string> = {
  no_iniciada:  "bg-gray-200 text-gray-700",
  en_proceso:   "bg-blue-500 text-white",
  en_revision:  "bg-yellow-400 text-yellow-900",
  completada:   "bg-green-500 text-white",
  pendiente:    "bg-orange-400 text-white",
  atrasada:     "bg-red-500 text-white",
  bloqueada:    "bg-purple-500 text-white",
  cancelada:    "bg-gray-300 text-gray-500",
};
const ESTADO_LABEL: Record<EstadoOTProgramada, string> = {
  no_iniciada: "No iniciada", en_proceso: "En proceso",
  en_revision: "En revisión", completada: "Completada",
  pendiente: "Pendiente", atrasada: "Atrasada",
  bloqueada: "Bloqueada", cancelada: "Cancelada",
};
const TIPO_COLOR: Record<string, string> = {
  P: "bg-blue-100 text-blue-800",
  C: "bg-red-100 text-red-800",
  S: "bg-purple-100 text-purple-800",
};

type BitacoraEntry = { turno: string; supervisor: string; nota: string; hhAtendidas: number; fecha?: string };

type Vista = "tabla" | "kanban" | "tecnico";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getMondayOfWeek(anio: number, semana: number): Date {
  const jan4 = new Date(Date.UTC(anio, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (semana - 1) * 7);
  return monday;
}

function pct(val: number, total: number) {
  if (!total) return 0;
  return Math.round((val / total) * 100);
}

function fmtFecha(date: Date, formato: "corto" | "largo" = "corto") {
  if (formato === "largo")
    return date.toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return date.toLocaleDateString("es-BO", { day: "2-digit", month: "short", timeZone: "UTC" });
}

// ─── Badge de Estado ──────────────────────────────────────────────────────────
function EstadoBadge({ estado }: { estado: EstadoOTProgramada }) {
  return (
    <span style={{
      padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700,
      whiteSpace: "nowrap", letterSpacing: "0.03em",
      ...ESTADO_STYLE[estado],
    }}>
      {ESTADO_LABEL[estado]}
    </span>
  );
}

const ESTADO_STYLE: Record<EstadoOTProgramada, React.CSSProperties> = {
  no_iniciada: { background: "#f1f5f9", color: "#475569" },
  en_proceso:  { background: "#dbeafe", color: "#1d4ed8" },
  en_revision: { background: "#fef3c7", color: "#92400e" },
  completada:  { background: "#dcfce7", color: "#166534" },
  pendiente:   { background: "#ffedd5", color: "#9a3412" },
  atrasada:    { background: "#fee2e2", color: "#991b1b" },
  bloqueada:   { background: "#ede9fe", color: "#5b21b6" },
  cancelada:   { background: "#f1f5f9", color: "#94a3b8" },
};

// ─── Selector de Estado ───────────────────────────────────────────────────────
// Componente especial para OTs de Guardia (OPEPLANT)
function EstadoGuardia({ ot }: { ot: IOTProgramada & { esGuardia?: boolean; bitacora?: BitacoraEntry[] } }) {
  const registros = ot.bitacora ?? [];
  const hhTotal = registros.reduce((s, b) => s + (b.hhAtendidas ?? 0), 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, padding: "2px 7px", display: "inline-block" }}>
        🔄 TURNERO · {registros.length} registro{registros.length !== 1 ? "s" : ""} · {hhTotal}HH
      </span>
      {registros.slice(-2).map((b, i) => (
        <div key={i} style={{ fontSize: 9, color: "#64748b", fontStyle: "italic", maxWidth: 180, overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis" }}>
          {b.turno}: {b.nota}
        </div>
      ))}
    </div>
  );
}

// Si la OT ya tiene OT interna registrada (ordenTrabajoId), el estado es de solo lectura
// y se muestra un enlace al tablero de revisión. El cambio de estado viene desde ahí.
function EstadoSelector({
  ot, programaId, onEstadoChange,
}: {
  ot: IOTProgramada;
  programaId: string;
  onEstadoChange: (id: string, nOT: string, dia: DiaSemana, estado: EstadoOTProgramada) => void;
}) {
  const [open, setOpen] = useState(false);
  const style = ESTADO_STYLE[ot.estado];
  const vinculada = !!ot.ordenTrabajoId;

  // OT vinculada a registro interno → solo lectura + link al tablero
  if (vinculada) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{
          ...style, padding: "3px 8px", borderRadius: 4, fontSize: 10,
          fontWeight: 700, whiteSpace: "nowrap" as const,
        }}>
          {ESTADO_LABEL[ot.estado]}
        </span>
        <a
          href={`/ordenes/reporte?ot=${ot.ordenTrabajoId}`}
          title={`Ver OT interna #${ot.ordenTrabajoNum}`}
          style={{ fontSize: 9, color: "#2563eb", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" as const }}
        >
          #{ot.ordenTrabajoNum} →
        </a>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          ...style, display: "flex", alignItems: "center", gap: 4,
          padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
          border: "none", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {ESTADO_LABEL[ot.estado]} <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", zIndex: 50, top: 26, left: 0,
          background: "white", boxShadow: "0 4px 16px rgba(15,40,71,0.15)",
          borderRadius: 10, border: "1px solid #e2e8f0", padding: 6, minWidth: 150,
        }}>
          {(Object.keys(ESTADO_LABEL) as EstadoOTProgramada[]).map((e) => (
            <button
              key={e}
              onClick={() => { onEstadoChange(programaId, ot.numeroOT, ot.dia as DiaSemana, e); setOpen(false); }}
              style={{
                width: "100%", textAlign: "left", padding: "5px 8px",
                borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
                background: ot.estado === e ? "#f1f5f9" : "transparent",
                fontWeight: ot.estado === e ? 700 : 400,
                color: "#1e293b",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: ESTADO_STYLE[e].background, border: `2px solid ${ESTADO_STYLE[e].color}` }} />
              {ESTADO_LABEL[e]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard de Ejecución ───────────────────────────────────────────────────
function Dashboard({
  programa, fechasDias, semana,
}: {
  programa: IProgramacionSemanal;
  fechasDias: Record<DiaSemana, Date>;
  semana: number;
}) {
  const ESTADOS_ACTIVOS: EstadoOTProgramada[] = ["en_proceso", "en_revision", "completada"];

  // Solo contar HH de días que ya terminaron (estrictamente antes de hoy)
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,"0")}-${String(hoy.getDate()).padStart(2,"0")}`;
  function diaPasado(dia: DiaSemana) {
    const f = fechasDias[dia];
    const fStr = f.toISOString().slice(0, 10);
    return fStr < hoyStr;
  }

  const ots = programa.otsProgramadas ?? [];
  const total       = ots.length;
  const completadas = ots.filter((o) => o.estado === "completada").length;
  const enProceso   = ots.filter((o) => o.estado === "en_proceso").length;
  const pendientes  = ots.filter((o) => o.estado === "pendiente" || o.estado === "no_iniciada").length;
  const atrasadas   = ots.filter((o) => o.estado === "atrasada").length;
  const bloqueadas  = ots.filter((o) => o.estado === "bloqueada").length;
  const hhProg      = programa.hhProgramadasSemana ?? 0;
  // HH ejecutadas: solo días ya transcurridos
  const hhEjec      = ots.filter((o) => ESTADOS_ACTIVOS.includes(o.estado) && diaPasado(o.dia as DiaSemana))
                         .reduce((s, o) => s + (o.hhTotal ?? 0), 0);
  const progreso    = pct(hhEjec, hhProg);
  const sinTecnico  = ots.filter((o) => !o.personalAsignado?.length).length;
  const barColor    = progreso >= 80 ? "#16a34a" : progreso >= 50 ? "#2563eb" : "#ea580c";

  return (
    <div style={{ background: "white", borderBottom: "1px solid #e2e8f0" }}>
      {/* Barra de progreso general */}
      <div style={{ padding: "14px 20px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#0f2847", letterSpacing: "0.06em" }}>
            PROGRESO SEMANA {semana} — {programa.disciplina}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>
            {progreso}% &nbsp;·&nbsp; {hhEjec}/{hhProg} HH ejecutadas
          </span>
        </div>
        <div style={{ height: 10, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progreso}%`, background: barColor, borderRadius: 6, transition: "width 0.5s" }} />
        </div>
      </div>

      {/* Grid 7 días */}
      <div style={{ padding: "4px 20px 10px", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 6, minWidth: "max-content" }}>
          {DIAS.map((dia) => {
            const otsDia    = ots.filter((o) => o.dia === dia);
            const hhDia     = otsDia.reduce((s, o) => s + (o.hhTotal ?? 0), 0);
            const esPasado  = diaPasado(dia);
            const hhEjecDia = esPasado
              ? otsDia.filter((o) => ESTADOS_ACTIVOS.includes(o.estado)).reduce((s, o) => s + (o.hhTotal ?? 0), 0)
              : 0;
            const concluidas = otsDia.filter((o) => o.estado === "completada").length;
            const tot        = otsDia.length;
            const p          = pct(hhEjecDia, hhDia);
            const color      = !esPasado ? "#cbd5e1" : p === 100 ? "#16a34a" : p >= 70 ? "#2563eb" : p > 0 ? "#ea580c" : "#94a3b8";
            return (
              <div key={dia} style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                background: esPasado ? "#f8fafc" : "#fafafa",
                borderRadius: 10, padding: "8px 12px",
                minWidth: 72, border: `1px solid ${esPasado ? "#e2e8f0" : "#f1f5f9"}`,
                opacity: esPasado ? 1 : 0.5,
              }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.07em" }}>{DIAS_CORTO[dia]}</span>
                <span style={{ fontSize: 9, color: "#cbd5e1", marginTop: 1 }}>{fmtFecha(fechasDias[dia])}</span>
                <span style={{ fontSize: 17, fontWeight: 900, color, marginTop: 3 }}>
                  {tot > 0 ? (esPasado ? `${p}%` : "—") : "—"}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginTop: 1 }}>
                  {esPasado ? `${hhEjecDia}/` : "0/"}{hhDia}HH
                </span>
                {esPasado && concluidas > 0 && (
                  <span style={{ fontSize: 9, color: "#16a34a", marginTop: 1 }}>{concluidas}/{tot} cerradas</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Métricas + Alertas */}
      <div style={{ padding: "4px 20px 12px", display: "flex", flexWrap: "wrap", gap: "4px 20px", fontSize: 12 }}>
        <Metric color="#16a34a" value={completadas} label="Concluidas" />
        <Metric color="#2563eb" value={enProceso} label="En proceso" />
        <Metric color="#ea580c" value={pendientes} label="Pendientes / No iniciadas" />
        <Metric color="#dc2626" value={atrasadas} label="Atrasadas" />
        {bloqueadas > 0 && <Metric color="#7c3aed" value={bloqueadas} label="Bloqueadas" />}
        <span style={{ color: "#cbd5e1" }}>|</span>
        <span style={{ color: "#475569" }}>
          HH prog: <b style={{ color: "#0f2847" }}>{hhProg}</b>
          &nbsp;·&nbsp; HH ejec: <b style={{ color: "#0f2847" }}>{hhEjec}</b>
          &nbsp;·&nbsp; Avance: <b style={{ color: progreso >= 80 ? "#16a34a" : "#ea580c" }}>{progreso}%</b>
        </span>
        {(atrasadas > 0 || sinTecnico > 0) && (
          <>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <span style={{ color: "#dc2626", fontWeight: 600 }}>
              ⚠{" "}
              {atrasadas > 0 && `${atrasadas} OTs atrasadas`}
              {atrasadas > 0 && sinTecnico > 0 && " · "}
              {sinTecnico > 0 && `${sinTecnico} sin técnico asignado`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <span style={{ color: "#475569" }}>
      <b style={{ color }}>{value}</b> {label}
    </span>
  );
}

// ─── Modal: Asignar Técnicos ──────────────────────────────────────────────────
function AsignarTecnicosModal({
  ot, areaCodigo, programaId, onSave, onClose,
}: {
  ot: IOTProgramada;
  areaCodigo: string;
  programaId: string;
  onSave: (updated: IOTProgramada) => void;
  onClose: () => void;
}) {
  const [tecnicos, setTecnicos] = useState<{ _id: string; nombre: string }[]>([]);
  const [seleccionados, setSeleccionados] = useState<string[]>(ot.personalAsignado ?? []);
  const [grupoEdit, setGrupoEdit] = useState<string>(ot.grupo ?? "Diurno");
  const [busqueda, setBusqueda] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/usuarios?all=true&area=${areaCodigo}`)
      .then(r => r.json())
      .then((data: { _id: string; nombre: string }[]) => setTecnicos(data))
      .catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [areaCodigo]);

  const filtrados = tecnicos.filter(t =>
    t.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  function toggle(nombre: string) {
    setSeleccionados(prev =>
      prev.includes(nombre) ? prev.filter(n => n !== nombre) : [...prev, nombre]
    );
  }

  async function guardar() {
    setSaving(true);
    // Derivar usuarioIds de los nombres seleccionados (match exacto por identidad).
    // Nombres sin usuario en la lista (ej. "Contratista" del Excel) quedan sin id.
    const ids = seleccionados
      .map(nombre => tecnicos.find(t => t.nombre === nombre)?._id)
      .filter((x): x is string => Boolean(x));
    const res = await fetch(`/api/programacion-semanal/${programaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numeroOT: ot.numeroOT, dia: ot.dia, grupo: ot.grupo, personalAsignado: seleccionados, personalAsignadoIds: ids, ...(grupoEdit !== ot.grupo ? { nuevoGrupo: grupoEdit } : {}) }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) {
      const otActualizada = data.programa.otsProgramadas?.find(
        (o: IOTProgramada) => o.numeroOT === ot.numeroOT && o.dia === ot.dia
      );
      onSave(otActualizada ?? { ...ot, personalAsignado: seleccionados });
    }
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,40,71,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "white", borderRadius: 14, padding: 24, width: "100%", maxWidth: 420,
        boxShadow: "0 8px 32px rgba(15,40,71,0.18)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#0f2847" }}>
              Asignar técnicos
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              OT {ot.numeroOT} · {ot.dia} · {ot.personas}p requeridas
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 14, color: "#64748b" }}>✕</button>
        </div>

        {/* Cambiar grupo (Diurno/Nocturno/G1...) */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: 4 }}>
            Grupo / Turno
          </label>
          <select
            value={grupoEdit}
            onChange={e => setGrupoEdit(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: grupoEdit !== ot.grupo ? "#fffbeb" : "white", fontWeight: grupoEdit !== ot.grupo ? 700 : 400 }}
          >
            {["G1","G2","G3","G4","Diurno","Nocturno"].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          {grupoEdit !== ot.grupo && (
            <p style={{ fontSize: 11, color: "#d97706", marginTop: 3 }}>⚠ Cambiará de <b>{ot.grupo}</b> → <b>{grupoEdit}</b></p>
          )}
        </div>

        <input
          ref={inputRef}
          placeholder="Buscar técnico..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, boxSizing: "border-box" as const, marginBottom: 10 }}
        />

        {/* Seleccionados */}
        {seleccionados.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {seleccionados.map(n => (
              <span key={n} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "#dbeafe", color: "#1d4ed8", borderRadius: 20,
                padding: "3px 10px", fontSize: 12, fontWeight: 600,
              }}>
                👤 {n}
                <button onClick={() => toggle(n)} style={{ background: "none", border: "none", cursor: "pointer", color: "#1d4ed8", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}

        {/* Lista */}
        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          {filtrados.length === 0 && (
            <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 16 }}>
              {tecnicos.length === 0 ? "Cargando técnicos..." : "Sin resultados"}
            </p>
          )}
          {filtrados.map(t => {
            const sel = seleccionados.includes(t.nombre);
            return (
              <button key={t._id} onClick={() => toggle(t.nombre)} style={{
                width: "100%", textAlign: "left", padding: "10px 14px",
                border: "none", borderBottom: "1px solid #f8fafc",
                background: sel ? "#eff6ff" : "white", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 4, border: `2px solid ${sel ? "#2563eb" : "#cbd5e1"}`,
                  background: sel ? "#2563eb" : "white", display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {sel && <span style={{ color: "white", fontSize: 11, fontWeight: 800 }}>✓</span>}
                </span>
                <span style={{ fontSize: 13, fontWeight: sel ? 700 : 400, color: sel ? "#1d4ed8" : "#1e293b" }}>
                  {t.nombre}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={guardar} disabled={saving} style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
            background: "#0f2847", color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>
            {saving ? "Guardando..." : `Guardar (${seleccionados.length} técnico${seleccionados.length !== 1 ? "s" : ""})`}
          </button>
          <button onClick={onClose} style={{
            padding: "9px 16px", borderRadius: 8, border: "1px solid #e2e8f0",
            background: "white", color: "#475569", fontSize: 13, cursor: "pointer",
          }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vista Tabla ──────────────────────────────────────────────────────────────
const GRUPO_COLOR: Record<string, { bg: string; color: string }> = {
  G1:      { bg: "#dbeafe", color: "#1d4ed8" },
  G2:      { bg: "#dcfce7", color: "#166534" },
  G3:      { bg: "#fef3c7", color: "#92400e" },
  G4:      { bg: "#ede9fe", color: "#5b21b6" },
  Diurno:  { bg: "#ffedd5", color: "#9a3412" },
  Nocturno:{ bg: "#1e293b", color: "#e2e8f0" },
};

function VistaTabla({
  ots, diaActivo, setDiaActivo, fechasDias, programa,
  filtros, programaId, onEstadoChange, isAdmin, areaCodigo, onPersonalChange,
}: {
  ots: IOTProgramada[];
  diaActivo: DiaSemana;
  setDiaActivo: (d: DiaSemana) => void;
  fechasDias: Record<DiaSemana, Date>;
  programa: IProgramacionSemanal;
  filtros: { tecnico: string; estado: string; turno: string; busqueda: string };
  programaId: string;
  onEstadoChange: (id: string, nOT: string, dia: DiaSemana, estado: EstadoOTProgramada) => void;
  isAdmin?: boolean;
  areaCodigo?: string;
  onPersonalChange?: (updated: IOTProgramada) => void;
}) {
  const [asignandoOT, setAsignandoOT] = useState<IOTProgramada | null>(null);
  const allOts = programa.otsProgramadas ?? [];

  function otsDia(dia: DiaSemana) {
    return allOts.filter((o) => {
      if (o.dia !== dia) return false;
      if (filtros.tecnico && !o.personalAsignado?.some((p) => p.toLowerCase().includes(filtros.tecnico.toLowerCase()))) return false;
      if (filtros.estado && o.estado !== filtros.estado) return false;
      if (filtros.turno && o.grupo !== filtros.turno) return false;
      if (filtros.busqueda) {
        const q = filtros.busqueda.toLowerCase();
        if (!o.numeroOT.toLowerCase().includes(q) && !o.tag.toLowerCase().includes(q) &&
            !o.descripcion.toLowerCase().includes(q) && !o.personalAsignado?.some((p) => p.toLowerCase().includes(q)))
          return false;
      }
      return true;
    });
  }

  const otsDelDia   = otsDia(diaActivo);
  const completadas = otsDelDia.filter((o) => o.estado === "completada").length;
  const hhProg      = otsDelDia.reduce((s, o) => s + (o.hhTotal ?? 0), 0);
  const hhEjec      = otsDelDia.filter((o) => o.estado === "completada").reduce((s, o) => s + (o.hhTotal ?? 0), 0);

  // Agrupar OTs del día por grupo en orden definido: G1→G2→G3→G4→Diurno→Nocturno
  const gruposPresentes = new Set(otsDelDia.map((o) => o.grupo));
  const grupos = GRUPOS.filter(g => gruposPresentes.has(g));

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Tabs de días */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", display: "flex", overflowX: "auto" }}>
        {DIAS.map((dia) => {
          const count  = otsDia(dia).length;
          const hecho  = otsDia(dia).filter((o) => o.estado === "completada").length;
          const hhDia  = otsDia(dia).reduce((s, o) => s + (o.hhTotal ?? 0), 0);
          const isActive = diaActivo === dia;
          return (
            <button key={dia} onClick={() => setDiaActivo(dia)} style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "10px 16px", border: "none", background: "transparent",
              borderBottom: `3px solid ${isActive ? "#0f2847" : "transparent"}`,
              cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
              color: isActive ? "#0f2847" : "#64748b",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{DIAS_FULL[dia]}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{fmtFecha(fechasDias[dia])}</span>
              {count > 0 && (
                <span style={{ fontSize: 10, marginTop: 2, color: isActive ? "#0f2847" : "#94a3b8", fontWeight: 600 }}>
                  {hecho}/{count} · {hhDia}HH
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Resumen del día */}
      <div style={{
        background: "#0f2847", color: "white", padding: "8px 20px",
        display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 12, alignItems: "center",
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          {DIAS_FULL[diaActivo].toUpperCase()} {fmtFecha(fechasDias[diaActivo], "largo")}
        </span>
        <span style={{ color: "#94a3b8" }}>·</span>
        <span>Planificado: <b>{otsDelDia.length} OTs</b></span>
        <span>Ejecutado: <b>{completadas} ({pct(completadas, otsDelDia.length)}%)</b></span>
        <span>HH prog: <b>{hhProg}</b></span>
        <span>HH ejec: <b style={{ color: hhEjec > 0 ? "#4ade80" : "#94a3b8" }}>{hhEjec}</b></span>
      </div>

      {/* Tabla con secciones por grupo */}
      {otsDelDia.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "#94a3b8", fontSize: 14 }}>
          No hay OTs programadas para {DIAS_FULL[diaActivo]}
          {filtros.busqueda || filtros.tecnico || filtros.estado ? " con los filtros aplicados" : ""}.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                {["No OT / Descripción", "TAG / Equipo", "Tipo", "Estado", "Grupo", "Técnico(s)", "HH"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => {
                const otsGrupo = otsDelDia.filter((o) => o.grupo === grupo);
                const gc = GRUPO_COLOR[grupo] ?? { bg: "#f1f5f9", color: "#475569" };
                const hhGrupo = otsGrupo.reduce((s, o) => s + (o.hhTotal ?? 0), 0);
                return [
                  // Encabezado de grupo
                  <tr key={`h-${grupo}`}>
                    <td colSpan={7} style={{ background: gc.bg, color: gc.color, padding: "5px 12px", fontWeight: 800, fontSize: 11, letterSpacing: "0.05em" }}>
                      {grupo.toUpperCase()} &nbsp;·&nbsp; {otsGrupo.length} OTs &nbsp;·&nbsp; {hhGrupo} HH
                    </td>
                  </tr>,
                  // Filas de OTs
                  ...otsGrupo.map((ot, i) => {
                    const rowBg = ot.estado === "atrasada" ? "#fff1f2" : ot.estado === "completada" ? "#f0fdf4" : i % 2 === 0 ? "white" : "#fafafa";
                    return (
                      <tr key={`${ot.numeroOT}-${grupo}-${i}`} style={{ background: rowBg, borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 14px", maxWidth: 240 }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#0f2847" }}>{ot.numeroOT}</span>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 3, lineHeight: 1.4 }}>{ot.descripcion}</div>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#1d4ed8" }}>{ot.tag}</span>
                          {ot.descripcionEquipo && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ot.descripcionEquipo}</div>}
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          <span style={{ ...tipoStyle(ot.tipoOT), padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                            {ot.tipoOT}
                          </span>
                          {ot.prioridad && ot.prioridad.trim() && (
                            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>P{ot.prioridad}</div>
                          )}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          {(ot as IOTProgramada & { esGuardia?: boolean }).esGuardia || ot.tag?.includes("OPEPLANT")
                            ? <EstadoGuardia ot={ot as IOTProgramada & { esGuardia?: boolean; bitacora?: BitacoraEntry[] }} />
                            : <EstadoSelector ot={ot} programaId={programaId} onEstadoChange={onEstadoChange} />
                          }
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ ...gc, padding: "3px 9px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{grupo}</span>
                        </td>
                        <td style={{ padding: "10px 14px", maxWidth: 200 }}>
                          {isAdmin ? (
                            <button
                              onClick={() => setAsignandoOT(ot)}
                              title="Clic para asignar técnicos"
                              style={{
                                background: "none", border: "none", cursor: "pointer",
                                textAlign: "left", padding: 0, width: "100%",
                              }}
                            >
                              {ot.personalAsignado?.length > 0 ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  {ot.personalAsignado.map((p, j) => (
                                    <span key={j} style={{ fontSize: 12, color: "#1e293b" }}>👤 {p}</span>
                                  ))}
                                  <span style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>✏ editar</span>
                                </div>
                              ) : (
                                <span style={{
                                  fontSize: 12, color: "#ef4444", fontStyle: "italic",
                                  display: "flex", alignItems: "center", gap: 4,
                                }}>
                                  Sin asignar <span style={{ fontSize: 11 }}>✏</span>
                                </span>
                              )}
                            </button>
                          ) : (
                            ot.personalAsignado?.length > 0 ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {ot.personalAsignado.map((p, j) => (
                                  <span key={j} style={{ fontSize: 12, color: "#1e293b" }}>👤 {p}</span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: "#ef4444", fontStyle: "italic" }}>Sin asignar</span>
                            )
                          )}
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontSize: 12, color: "#475569" }}>
                          {ot.personas}p × {ot.hrsTrabajo}h = <b style={{ color: "#0f2847" }}>{ot.hhTotal}HH</b>
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal asignación de técnicos (solo Admin) */}
      {asignandoOT && isAdmin && areaCodigo && (
        <AsignarTecnicosModal
          ot={asignandoOT}
          areaCodigo={areaCodigo}
          programaId={programaId}
          onSave={(updated) => {
            onPersonalChange?.(updated);
            setAsignandoOT(null);
          }}
          onClose={() => setAsignandoOT(null)}
        />
      )}
    </div>
  );
}

function tipoStyle(tipoOT: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    CMP: { background: "#fee2e2", color: "#991b1b" },
    CMR: { background: "#fef3c7", color: "#92400e" },
    PMP: { background: "#dbeafe", color: "#1d4ed8" },
    PMT: { background: "#dcfce7", color: "#166534" },
    PTJ: { background: "#ede9fe", color: "#5b21b6" },
    PdM: { background: "#e0f2fe", color: "#0369a1" },
    P:   { background: "#dbeafe", color: "#1d4ed8" },
    C:   { background: "#fee2e2", color: "#991b1b" },
    S:   { background: "#ede9fe", color: "#5b21b6" },
  };
  return map[tipoOT] ?? { background: "#f1f5f9", color: "#475569" };
}

// ─── Vista Kanban ──────────────────────────────────────────────────────────────
const KANBAN_COLS: { key: EstadoOTProgramada; label: string; headerBg: string; headerColor: string; colBg: string }[] = [
  { key: "no_iniciada", label: "No iniciada", headerBg: "#f1f5f9", headerColor: "#475569", colBg: "#f8fafc" },
  { key: "pendiente",   label: "Pendiente",   headerBg: "#ffedd5", headerColor: "#9a3412", colBg: "#fff7ed" },
  { key: "en_proceso",  label: "En proceso",  headerBg: "#dbeafe", headerColor: "#1d4ed8", colBg: "#eff6ff" },
  { key: "en_revision", label: "En revisión", headerBg: "#fef3c7", headerColor: "#92400e", colBg: "#fffbeb" },
  { key: "completada",  label: "Completada",  headerBg: "#dcfce7", headerColor: "#166534", colBg: "#f0fdf4" },
  { key: "atrasada",    label: "Atrasada",    headerBg: "#fee2e2", headerColor: "#991b1b", colBg: "#fff1f2" },
];

function VistaKanban({
  ots, programaId, onEstadoChange,
}: {
  ots: IOTProgramada[];
  programaId: string;
  onEstadoChange: (id: string, nOT: string, dia: DiaSemana, estado: EstadoOTProgramada) => void;
}) {
  return (
    <div style={{ padding: 16, overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 12, minWidth: "max-content", alignItems: "flex-start" }}>
        {KANBAN_COLS.map(({ key, label, headerBg, headerColor, colBg }) => {
          const items = ots.filter((o) => o.estado === key);
          return (
            <div key={key} style={{ width: 220, display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", flexShrink: 0 }}>
              {/* Cabecera de columna */}
              <div style={{ background: headerBg, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: headerColor, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: headerColor, background: "rgba(255,255,255,0.6)", borderRadius: 20, padding: "1px 8px" }}>{items.length}</span>
              </div>
              {/* Tarjetas */}
              <div style={{ background: colBg, display: "flex", flexDirection: "column", gap: 8, padding: 8, minHeight: 120 }}>
                {items.length === 0 && (
                  <p style={{ fontSize: 11, color: "#cbd5e1", textAlign: "center", padding: "16px 0", fontStyle: "italic" }}>Vacío</p>
                )}
                {items.map((ot, i) => {
                  const gc = GRUPO_COLOR[ot.grupo] ?? { bg: "#f1f5f9", color: "#475569" };
                  return (
                    <div key={`${ot.numeroOT}-${i}`} style={{ background: "white", borderRadius: 10, border: "1px solid #f1f5f9", padding: 10, boxShadow: "0 1px 4px rgba(15,40,71,0.06)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: "#0f2847" }}>{ot.numeroOT}</span>
                        <span style={{ ...tipoStyle(ot.tipoOT), padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{ot.tipoOT}</span>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginTop: 3 }}>{ot.tag}</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{ot.descripcion}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                        <span style={{ ...gc, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>{ot.dia} · {ot.grupo}</span>
                        <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{ot.hhTotal}HH</span>
                      </div>
                      {ot.personalAsignado?.length > 0 && (
                        <div style={{ fontSize: 10, color: "#475569", marginTop: 4, borderTop: "1px solid #f1f5f9", paddingTop: 4 }}>
                          👤 {ot.personalAsignado.join(" / ")}
                        </div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <EstadoSelector ot={ot} programaId={programaId} onEstadoChange={onEstadoChange} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vista Técnico ────────────────────────────────────────────────────────────
function VistaTecnico({
  ots, programaId, onEstadoChange, fechasDias, filtroTecnico,
}: {
  ots: IOTProgramada[];
  programaId: string;
  onEstadoChange: (id: string, nOT: string, dia: DiaSemana, estado: EstadoOTProgramada) => void;
  fechasDias: Record<DiaSemana, Date>;
  filtroTecnico: string;
}) {
  const completadas = ots.filter((o) => o.estado === "completada").length;
  const progreso    = pct(completadas, ots.length);
  const barColor    = progreso >= 80 ? "#16a34a" : progreso >= 50 ? "#2563eb" : "#ea580c";

  return (
    <div style={{ padding: 20, maxWidth: 720, margin: "0 auto" }}>
      {/* Header de progreso personal */}
      <div style={{ background: "white", borderRadius: 14, border: "1px solid #e2e8f0", padding: 20, marginBottom: 16, boxShadow: "0 2px 12px rgba(15,40,71,0.07)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#0f2847" }}>{filtroTecnico || "Todos los técnicos"}</p>
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{ots.length} OTs asignadas esta semana</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: barColor }}>{progreso}%</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{completadas}/{ots.length} completadas</div>
          </div>
        </div>
        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progreso}%`, background: barColor, borderRadius: 6, transition: "width 0.5s" }} />
        </div>
      </div>

      {/* OTs agrupadas por día */}
      {DIAS.map((dia) => {
        const otsDia = ots.filter((o) => o.dia === dia);
        if (otsDia.length === 0) return null;
        const hecho   = otsDia.filter((o) => o.estado === "completada").length;
        const hhDia   = otsDia.reduce((s, o) => s + (o.hhTotal ?? 0), 0);
        const pDia    = pct(hecho, otsDia.length);
        return (
          <div key={dia} style={{ marginBottom: 20 }}>
            {/* Cabecera del día */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "8px 12px", background: "#0f2847", borderRadius: 10, color: "white" }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{DIAS_FULL[dia]} {fmtFecha(fechasDias[dia])}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{hecho}/{otsDia.length} OTs · {hhDia}HH · {pDia}%</span>
            </div>
            {/* Tarjetas de OTs */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {otsDia.map((ot, i) => {
                const s = ESTADO_STYLE[ot.estado];
                const gc = GRUPO_COLOR[ot.grupo] ?? { bg: "#f1f5f9", color: "#475569" };
                return (
                  <div key={`${ot.numeroOT}-${i}`} style={{ background: "white", borderRadius: 12, border: `1px solid ${s.background}`, padding: 14, boxShadow: "0 1px 4px rgba(15,40,71,0.05)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: "#0f2847" }}>{ot.numeroOT}</span>
                        <span style={{ ...tipoStyle(ot.tipoOT), padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{ot.tipoOT}</span>
                        <span style={{ ...gc, padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{ot.grupo}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginTop: 4 }}>{ot.tag}</div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 2, lineHeight: 1.5 }}>{ot.descripcion}</div>
                      {ot.personalAsignado?.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#0f2847" }}>
                          👤 <b>{ot.personalAsignado.join(" / ")}</b>
                        </div>
                      )}
                      <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
                        {ot.personas}p × {ot.hrsTrabajo}h = <b style={{ color: "#475569" }}>{ot.hhTotal}HH</b>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <EstadoSelector ot={ot} programaId={programaId} onEstadoChange={onEstadoChange} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {ots.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "#94a3b8", fontSize: 14 }}>
          {filtroTecnico ? `No hay OTs asignadas a "${filtroTecnico}"` : "No hay OTs con los filtros actuales"}
        </div>
      )}
    </div>
  );
}

// ─── Modal de carga Excel / CSV ───────────────────────────────────────────────
const DIAS_VALIDOS_SET = new Set(["Lu","Ma","Mi","Ju","Vi","Sa","Do"]);
const GRUPO_MAP_MODAL: Record<string, GrupoTrabajo> = {
  "Grupo 1":"G1","Grupo 2":"G2","Grupo 3":"G3","Grupo 4":"G4",
  "Diurno":"Diurno","Nocturno":"Nocturno",
  "G1":"G1","G2":"G2","G3":"G3","G4":"G4",
};

function parseSheetRows(rows: unknown[][]): IOTProgramada[] {
  const ots: IOTProgramada[] = [];
  for (const row of rows) {
    const noOT   = row[0];
    const tipoOT = row[1];
    const dia    = String(row[12] ?? "").trim();
    const grupo  = String(row[11] ?? "").trim();
    const noOTStr = String(noOT ?? "").trim();
    if (noOTStr && (typeof noOT === "number" || /^\d+$/.test(noOTStr)) && tipoOT && DIAS_VALIDOS_SET.has(dia)) {
      const personas   = Number(row[7]) || 1;
      const hrsTrabajo = Number(row[8]) || 0;
      const hhTotal    = Number(row[9]) || personas * hrsTrabajo;
      const personalRaw = String(row[10] ?? "");
      ots.push({
        numeroOT:          noOTStr,
        tipoOT:            String(tipoOT).trim().toUpperCase(),
        tipoTrabajo:       String(row[2] ?? "").trim(),
        prioridad:         String(row[3] ?? "").trim() || undefined,
        descripcion:       String(row[4] ?? "").trim() || `OT ${noOT}`,
        tag:               String(row[5] ?? "").trim().toUpperCase(),
        descripcionEquipo: String(row[6] ?? "").trim(),
        personas, hrsTrabajo, hhTotal,
        personalAsignado: personalRaw
          ? personalRaw.split(/[/+]/).map(s => s.trim()).filter(Boolean)
          : [],
        grupo: (GRUPO_MAP_MODAL[grupo] ?? (grupo ? undefined : "Diurno")) as GrupoTrabajo || "Diurno",
        dia:   dia as DiaSemana,
        estado: "no_iniciada" as EstadoOTProgramada,
      });
    }
  }
  return ots;
}

function CargaCSVModal({
  semana, anio, disciplina, areaCodigo, subidoPor, onClose, onSuccess,
}: {
  semana: number; anio: number; disciplina: string; areaCodigo: string; subidoPor: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<"excel" | "csv">("excel");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Estado Excel
  const [fileName, setFileName]       = useState("");
  const [hojas, setHojas]             = useState<string[]>([]);
  const [hojaSeleccionada, setHoja]   = useState("");
  const [preview, setPreview]         = useState<IOTProgramada[]>([]);
  const [parsedRows, setParsedRows]   = useState<unknown[][]>([]);
  const [loadingExcel, setLoadingExcel] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(""); setHojas([]); setHoja(""); setPreview([]);
    setLoadingExcel(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });

      // Buscar hojas que coincidan con el patrón *-{semana} o *-{semana_2dig}
      const semStr2 = String(semana).padStart(2, "0");
      const candidatas = wb.SheetNames.filter(s => {
        const up = s.toUpperCase();
        return up.endsWith(`-${semana}`) || up.endsWith(`-${semStr2}`);
      });

      setHojas(candidatas.length > 0 ? candidatas : wb.SheetNames);

      // Auto-seleccionar si hay exactamente una candidata
      const auto = candidatas.length === 1 ? candidatas[0] : "";
      setHoja(auto);
      if (auto) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[auto], { header: 1, defval: "" });
        setParsedRows(rows);
        setPreview(parseSheetRows(rows));
      } else {
        // Guardar el workbook en ref para usarlo después
        (fileRef as React.MutableRefObject<unknown>).current = wb;
      }
    } catch {
      setError("No se pudo leer el archivo Excel.");
    } finally {
      setLoadingExcel(false);
    }
  }

  async function handleHojaChange(nombre: string) {
    setHoja(nombre);
    setPreview([]);
    if (!nombre) return;
    try {
      const XLSX = await import("xlsx");
      // Leer el archivo de nuevo si no tenemos el wb en memoria
      const file = (fileRef.current as unknown as HTMLInputElement)?.files?.[0];
      if (!file) return;
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, defval: "" });
      setParsedRows(rows);
      setPreview(parseSheetRows(rows));
    } catch {
      setError("Error al leer la hoja seleccionada.");
    }
  }

  function parseCSV(text: string): IOTProgramada[] {
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const header = lines[0].toLowerCase();
    const startRow = header.includes("numeroot") || header.includes("no ot") || header.includes("numero") ? 1 : 0;
    return lines.slice(startRow).map((line) => {
      const cols = line.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
      const [nOT, tipoOT, tipoTrabajo, prioridad, descripcion, tag, descEq, personas, hrs, personal, grupo, dia] = cols;
      const p = Number(personas) || 1;
      const h = Number(hrs) || 0;
      return {
        numeroOT: nOT, tipoOT: tipoOT || "P", tipoTrabajo: tipoTrabajo || "",
        prioridad: prioridad || undefined, descripcion: descripcion || "",
        tag: (tag || "").toUpperCase(), descripcionEquipo: descEq || "",
        personas: p, hrsTrabajo: h, hhTotal: p * h,
        personalAsignado: personal ? personal.split("/").map((n) => n.trim()).filter(Boolean) : [],
        grupo: (grupo as GrupoTrabajo) || "Diurno",
        dia: (dia as DiaSemana) || "Lu",
        estado: "no_iniciada" as EstadoOTProgramada,
      };
    });
  }

  async function handleGuardar() {
    try {
      setSaving(true); setError("");
      if (!areaCodigo) { setError("Sin área activa — selecciona un área antes de subir el plan"); setSaving(false); return; }
      const ots = modo === "excel" ? preview : parseCSV(csv);
      if (!ots.length) { setError("No se encontraron OTs válidas"); return; }

      const lunes   = getMondayOfWeek(anio, semana);
      const domingo = new Date(lunes);
      domingo.setUTCDate(lunes.getUTCDate() + 6);

      // Calcular HH para el payload
      const hhProgramadas = ots.reduce((s, o) => s + (o.hhTotal ?? 0), 0);

      const res = await fetch("/api/programacion-semanal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          semana, anio, disciplina, areaCodigo,
          fechaInicio:         lunes.toISOString(),
          fechaFin:            domingo.toISOString(),
          hhProgramadasSemana: hhProgramadas,
          otsProgramadas: ots,
          personal: [],
          subidoPor,
          estado: "publicado",
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Error al importar"); return; }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setSaving(false);
    }
  }

  const otsListas = modo === "excel" ? preview : (csv.trim() ? [] : []);
  const puedeGuardar = modo === "excel" ? preview.length > 0 : csv.trim().length > 0;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,40,71,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: 16,
    }}>
      <div style={{
        background: "white", borderRadius: 16, boxShadow: "0 8px 40px rgba(15,40,71,0.22)",
        width: "100%", maxWidth: 700, maxHeight: "90vh", display: "flex", flexDirection: "column", padding: 28, gap: 16,
        overflowY: "auto",
      }}>
        {/* Cabecera */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, color: "#0f2847", margin: 0 }}>Subir Programación</p>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              Semana {semana} · {anio} · {disciplina}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: "1px solid #e2e8f0",
            background: "white", cursor: "pointer", fontSize: 16, color: "#64748b",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        {/* Selector de modo */}
        <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
          {(["excel","csv"] as const).map(m => (
            <button key={m} onClick={() => setModo(m)} style={{
              flex: 1, padding: "9px 0", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: modo === m ? "#0f2847" : "white",
              color: modo === m ? "white" : "#64748b",
            }}>
              {m === "excel" ? "📊 Archivo Excel (.xlsx)" : "📝 Pegar CSV"}
            </button>
          ))}
        </div>

        {/* ── Modo Excel ── */}
        {modo === "excel" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Drop zone */}
            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "24px 16px", borderRadius: 12, cursor: "pointer",
              border: fileName ? "2px solid #86efac" : "2px dashed #cbd5e1",
              background: fileName ? "#f0fdf4" : "#f8fafc",
            }}>
              <span style={{ fontSize: 32 }}>{fileName ? "✅" : "📂"}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: fileName ? "#16a34a" : "#475569" }}>
                {fileName || "Seleccionar archivo Excel (.xlsx)"}
              </span>
              {!fileName && (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>
                  El sistema detectará automáticamente la hoja de semana {semana}
                </span>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileChange} />
            </label>

            {loadingExcel && (
              <p style={{ textAlign: "center", color: "#64748b", fontSize: 13 }}>Leyendo archivo…</p>
            )}

            {/* Selector de hoja si hay varias candidatas o ninguna auto-detectada */}
            {hojas.length > 1 && !loadingExcel && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
                  {hojas.some(h => {
                    const s2 = String(semana).padStart(2,"0");
                    return h.toUpperCase().endsWith(`-${semana}`) || h.toUpperCase().endsWith(`-${s2}`);
                  })
                    ? `Se encontraron ${hojas.length} hojas para semana ${semana} — selecciona la correcta:`
                    : `No se detectó hoja para semana ${semana}. Selecciona manualmente:`
                  }
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {hojas.map(h => (
                    <button key={h} onClick={() => handleHojaChange(h)} style={{
                      padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12,
                      border: `2px solid ${hojaSeleccionada === h ? "#0f2847" : "#e2e8f0"}`,
                      background: hojaSeleccionada === h ? "#0f2847" : "white",
                      color: hojaSeleccionada === h ? "white" : "#475569",
                    }}>
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            {preview.length > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px" }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: "#16a34a", margin: "0 0 10px" }}>
                  ✓ {preview.length} OTs detectadas en hoja &quot;{hojaSeleccionada}&quot;
                </p>
                <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 12 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#dcfce7" }}>
                        {["OT","Tipo","Descripción","TAG","Pers.","HH","Grupo","Día"].map(h => (
                          <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#15803d", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 10).map((o, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f0fdf4" }}>
                          <td style={{ padding: "4px 8px", fontWeight: 700 }}>{o.numeroOT}</td>
                          <td style={{ padding: "4px 8px" }}>{o.tipoOT}</td>
                          <td style={{ padding: "4px 8px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.descripcion}</td>
                          <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{o.tag}</td>
                          <td style={{ padding: "4px 8px", textAlign: "center" }}>{o.personas}</td>
                          <td style={{ padding: "4px 8px", textAlign: "center" }}>{o.hhTotal}</td>
                          <td style={{ padding: "4px 8px" }}>{o.grupo}</td>
                          <td style={{ padding: "4px 8px" }}>{o.dia}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.length > 10 && (
                    <p style={{ color: "#64748b", fontSize: 11, margin: "6px 0 0", textAlign: "center" }}>
                      …y {preview.length - 10} OTs más
                    </p>
                  )}
                </div>
              </div>
            )}

            {fileName && !loadingExcel && preview.length === 0 && hojaSeleccionada && (
              <p style={{ color: "#ea580c", fontSize: 13, textAlign: "center" }}>
                No se encontraron OTs válidas en la hoja &quot;{hojaSeleccionada}&quot;
              </p>
            )}
          </div>
        )}

        {/* ── Modo CSV ── */}
        {modo === "csv" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "#eff6ff", borderRadius: 10, padding: "10px 14px", border: "1px solid #bfdbfe", fontSize: 11, color: "#1e40af" }}>
              <b>Formato:</b> numeroOT ; tipoOT ; tipoTrabajo ; prioridad ; descripcion ; tag ; descEquipo ; personas ; hrsTrabajo ; personal ; grupo ; dia
            </div>
            <textarea
              style={{
                border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px",
                fontSize: 12, fontFamily: "monospace", height: 200, resize: "none",
                outline: "none", color: "#1e293b", lineHeight: 1.6,
              }}
              placeholder={"893674;PDM;PdM-PREDICTIVO;;26S Calibración;ENVSCRTY;Environment;1;10;Vladimir Mendoza;G1;Lu"}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </div>
        )}

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#dc2626" }}>
            {error}
          </div>
        )}

        {/* Acciones */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{
            padding: "9px 20px", borderRadius: 8, border: "1px solid #e2e8f0",
            background: "white", fontSize: 14, color: "#475569", cursor: "pointer", fontWeight: 600,
          }}>
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={saving || !puedeGuardar}
            style={{
              padding: "9px 20px", borderRadius: 8, border: "none",
              background: saving || !puedeGuardar ? "#94a3b8" : "#0f2847",
              color: "white", fontSize: 14, fontWeight: 700,
              cursor: saving || !puedeGuardar ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Importando..." : `↑ Importar ${otsListas.length > 0 ? `${otsListas.length} OTs` : "programación"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function SemanalesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();

  const hoy = new Date();
  const [semana,    setSemana]    = useState(isoWeekNumber(hoy));
  const [anio,      setAnio]      = useState(hoy.getFullYear());
  const [areas,     setAreas]     = useState<IArea[]>([]);
  const [areaActiva, setAreaActiva] = useState<IArea | null>(null);
  const [diaActivo, setDiaActivo] = useState<DiaSemana>("Lu");
  const [programa,  setPrograma]  = useState<IProgramacionSemanal | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [vista,     setVista]     = useState<Vista>("tabla");
  const [showCSV,   setShowCSV]   = useState(false);

  // Filtros
  const [filtroTecnico, setFiltroTecnico] = useState("");
  const [filtroEstado,  setFiltroEstado]  = useState("");
  const [filtroTurno,   setFiltroTurno]   = useState("");
  const [busqueda,      setBusqueda]      = useState("");

  // Cargar áreas al inicio (filtradas por las del usuario)
  useEffect(() => {
    if (!user) return;
    fetch("/api/areas")
      .then((r) => r.json())
      .then((data: IArea[]) => {
        if (!Array.isArray(data)) return;
        // Admin/Superintendente ven todas las áreas operativas; Supervisor/Planificador solo sus áreas
        const operativas = data.filter((a) => AREAS_SEMANAL.has(a.codigo));
        const visible = (user.rol <= 2)
          ? operativas
          : operativas.filter((a) => user.areas.includes(a.codigo));
        if (visible.length === 0) return;
        setAreas(visible);
        // Priorizar el área del usuario; si no está en la lista, tomar la primera disponible
        const userPrimaryArea = user.areas?.[0];
        const defaultArea = visible.find((a) => a.codigo === userPrimaryArea) ?? visible[0];
        setAreaActiva(defaultArea);
      })
      .catch(() => {});
  }, [user]);

  // Fechas de la semana
  const lunes = getMondayOfWeek(anio, semana);
  const fechasDias = useMemo(() => {
    const fd: Record<DiaSemana, Date> = {} as Record<DiaSemana, Date>;
    DIAS.forEach((d, i) => {
      const f = new Date(lunes);
      f.setUTCDate(lunes.getUTCDate() + i);
      fd[d] = f;
    });
    return fd;
  }, [lunes]);

  // Lista de técnicos para el filtro
  const tecnicos = useMemo(() => {
    if (!programa) return [];
    const set = new Set<string>();
    programa.otsProgramadas?.forEach((o) => o.personalAsignado?.forEach((p) => set.add(p)));
    return Array.from(set).sort();
  }, [programa]);

  const cargarPrograma = useCallback(async () => {
    if (!areaActiva) return;
    setLoading(true);
    try {
      const disciplina = areaToDisciplina(areaActiva.codigo);
      const params = new URLSearchParams({
        semana: String(semana),
        anio:   String(anio),
        disciplina,
        areaCodigo: areaActiva.codigo,
        limit:  "1",
      });
      const res  = await fetch(`/api/programacion-semanal?${params}`);
      const data = await res.json();
      // Si no hay por areaCodigo específico, buscar solo por disciplina (datos compartidos como MEC)
      if (Array.isArray(data) && data.length > 0) {
        setPrograma(data[0]);
      } else {
        // Fallback: buscar solo por disciplina (para áreas MEC sin programacion propia)
        const params2 = new URLSearchParams({ semana: String(semana), anio: String(anio), disciplina, limit: "1" });
        const res2  = await fetch(`/api/programacion-semanal?${params2}`);
        const data2 = await res2.json();
        setPrograma(Array.isArray(data2) && data2.length > 0 ? data2[0] : null);
      }
    } finally {
      setLoading(false);
    }
  }, [semana, anio, areaActiva]);

  useEffect(() => { cargarPrograma(); }, [cargarPrograma]);

  async function handleEstadoChange(
    programaId: string, numeroOT: string, dia: DiaSemana, estado: EstadoOTProgramada
  ) {
    const res = await fetch(`/api/programacion-semanal/${programaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numeroOT, dia, estado }),
    });
    const data = await res.json();
    if (data.ok) setPrograma(data.programa);
  }

  function handlePersonalChange(updated: IOTProgramada) {
    if (!programa) return;
    setPrograma({
      ...programa,
      otsProgramadas: (programa.otsProgramadas ?? []).map(o =>
        o.numeroOT === updated.numeroOT && o.dia === updated.dia ? updated : o
      ),
    });
  }

  // OTs filtradas
  const otsFiltradas = useMemo(() => {
    if (!programa) return [];
    return (programa.otsProgramadas ?? []).filter((o) => {
      if (filtroTecnico && !o.personalAsignado?.some((p) => p.toLowerCase().includes(filtroTecnico.toLowerCase()))) return false;
      if (filtroEstado && o.estado !== filtroEstado) return false;
      if (filtroTurno && o.grupo !== filtroTurno) return false;
      if (busqueda) {
        const q = busqueda.toLowerCase();
        if (!o.numeroOT.toLowerCase().includes(q) && !o.tag.toLowerCase().includes(q) &&
            !o.descripcion.toLowerCase().includes(q) && !o.personalAsignado?.some((p) => p.toLowerCase().includes(q)))
          return false;
      }
      return true;
    });
  }, [programa, filtroTecnico, filtroEstado, filtroTurno, busqueda]);

  function navSemana(dir: -1 | 1) {
    const nueva = semana + dir;
    if (nueva < 1)  { setSemana(52); setAnio((a) => a - 1); }
    else if (nueva > 52) { setSemana(1); setAnio((a) => a + 1); }
    else setSemana(nueva);
  }

  const programaId = String(programa?._id ?? "");

  const selectStyle: React.CSSProperties = {
    border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 13px",
    fontSize: 14, color: "#475569", background: "white", outline: "none",
    cursor: "pointer",
  };

  const btnVista = (v: Vista, label: string) => (
    <button key={v} onClick={() => setVista(v)} style={{
      padding: "7px 16px", fontSize: 14, fontWeight: 600, border: "none",
      cursor: "pointer", transition: "all 0.15s",
      background: vista === v ? "#0f2847" : "transparent",
      color: vista === v ? "white" : "#64748b",
    }}>
      {label}
    </button>
  );

  // Guard: esperar auth, luego verificar acceso
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#64748b", fontSize: 15 }}>Cargando...</span>
      </div>
    );
  }
  if (!user || !puedeVerSemanales(user.rol)) {
    // Redirigir a inicio si no tiene acceso
    router.replace("/inicio");
    return null;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", flexDirection: "column" }}>
      <AppHeader backHref="/ordenes" />

      {/* ── Pestañas de Área (bajo el header) ── */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", overflowX: "auto" }}>
        <div style={{ display: "flex", padding: "0 20px", gap: 0, minWidth: "max-content" }}>
          {areas.map((area) => {
            const isActive = areaActiva?.codigo === area.codigo;
            return (
              <button
                key={area.codigo}
                onClick={() => { setAreaActiva(area); setPrograma(null); }}
                style={{
                  padding: "12px 18px", fontSize: 15, fontWeight: isActive ? 800 : 500,
                  border: "none", background: "transparent", cursor: "pointer",
                  borderBottom: `3px solid ${isActive ? "#0f2847" : "transparent"}`,
                  color: isActive ? "#0f2847" : "#64748b",
                  whiteSpace: "nowrap", transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                  background: isActive ? "#0f2847" : "#f1f5f9",
                  color: isActive ? "white" : "#94a3b8",
                }}>
                  {area.codigo}
                </span>
                {area.nombre}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Barra de controles ── */}
      <div style={{
        background: "white", borderBottom: "1px solid #e2e8f0",
        padding: "10px 20px", display: "flex", flexWrap: "wrap",
        alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 30,
        boxShadow: "0 2px 8px rgba(15,40,71,0.06)",
      }}>
        {/* Navegador semana */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => navSemana(-1)} style={{
            width: 34, height: 34, borderRadius: 8, border: "1px solid #e2e8f0",
            background: "white", cursor: "pointer", fontSize: 18, fontWeight: 700,
            color: "#0f2847", display: "flex", alignItems: "center", justifyContent: "center",
          }}>‹</button>
          <div style={{
            fontSize: 16, fontWeight: 800, color: "#0f2847",
            minWidth: 130, textAlign: "center",
            background: "#f8fafc", borderRadius: 8, padding: "6px 12px",
            border: "1px solid #e2e8f0",
          }}>
            Semana {semana} · {anio}
          </div>
          <button onClick={() => navSemana(1)} style={{
            width: 34, height: 34, borderRadius: 8, border: "1px solid #e2e8f0",
            background: "white", cursor: "pointer", fontSize: 18, fontWeight: 700,
            color: "#0f2847", display: "flex", alignItems: "center", justifyContent: "center",
          }}>›</button>
          <span style={{ fontSize: 14, color: "#94a3b8" }}>
            {fmtFecha(lunes)} — {fmtFecha(fechasDias["Do"])}
          </span>
        </div>

        {/* Área activa + estado */}
        {areaActiva && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
              {areaActiva.codigo} · {areaActiva.nombre}
            </span>
            {programa && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                background: programa.estado === "publicado" ? "#dcfce7" : programa.estado === "cerrado" ? "#f1f5f9" : "#fef3c7",
                color: programa.estado === "publicado" ? "#166534" : programa.estado === "cerrado" ? "#64748b" : "#92400e",
                border: `1px solid ${programa.estado === "publicado" ? "#bbf7d0" : "#fde68a"}`,
              }}>
                {programa.estado === "publicado" ? "● Publicado" : programa.estado === "cerrado" ? "Cerrado" : "Borrador"}
              </span>
            )}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Filtros */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {tecnicos.length > 0 && (
            <select value={filtroTecnico} onChange={(e) => setFiltroTecnico(e.target.value)} style={selectStyle}>
              <option value="">Técnico: Todos</option>
              {tecnicos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={selectStyle}>
            <option value="">Estado: Todos</option>
            {(Object.keys(ESTADO_LABEL) as EstadoOTProgramada[]).map((e) => (
              <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
            ))}
          </select>
          <select value={filtroTurno} onChange={(e) => setFiltroTurno(e.target.value)} style={selectStyle}>
            <option value="">Turno: Todos</option>
            {GRUPOS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <input
            type="text" placeholder="Buscar OT, TAG, técnico..."
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            style={{ ...selectStyle, width: 180 }}
          />
        </div>

        {/* Vistas */}
        <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          {btnVista("tabla", "Tabla")}
          {btnVista("kanban", "Kanban")}
          {btnVista("tecnico", "Técnico")}
        </div>

        {/* Subir */}
        <button onClick={() => setShowCSV(true)} style={{
          padding: "7px 16px", borderRadius: 8,
          background: "#0f2847", color: "white", border: "none",
          fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
        }}>
          ↑ Subir programación
        </button>
      </div>

      {/* ── Contenido ── */}
      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 15 }}>
          Cargando programación...
        </div>
      )}

      {!loading && !programa && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{
            background: "white", borderRadius: 20, padding: "40px 48px", textAlign: "center",
            boxShadow: "0 4px 24px rgba(15,40,71,0.08)", border: "1px solid #f1f5f9",
            maxWidth: 440,
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#0f2847", marginBottom: 6 }}>
              Sin programación
            </p>
            <p style={{ fontSize: 14, color: "#64748b", marginBottom: 6 }}>
              Semana {semana} / {anio} — {areaActiva?.nombre ?? ""}
            </p>
            <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24, lineHeight: 1.6 }}>
              No se encontró programación para esta semana. Puedes importarla desde un archivo Excel o CSV.
            </p>
            <button onClick={() => setShowCSV(true)} style={{
              padding: "10px 24px", borderRadius: 10,
              background: "#0f2847", color: "white", border: "none",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 2px 8px rgba(15,40,71,0.2)",
            }}>
              ↑ Subir programación
            </button>
          </div>
        </div>
      )}

      {!loading && programa && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Dashboard programa={programa} fechasDias={fechasDias} semana={semana} />
          <div style={{ flex: 1, overflow: "auto" }}>
            {vista === "tabla" && (
              <VistaTabla
                ots={otsFiltradas} diaActivo={diaActivo} setDiaActivo={setDiaActivo}
                fechasDias={fechasDias} programa={programa}
                filtros={{ tecnico: filtroTecnico, estado: filtroEstado, turno: filtroTurno, busqueda }}
                programaId={programaId} onEstadoChange={handleEstadoChange}
                isAdmin={user?.rol === 1 || user?.rol === 3}
                areaCodigo={areaActiva?.codigo}
                onPersonalChange={handlePersonalChange}
              />
            )}
            {vista === "kanban" && (
              <VistaKanban ots={otsFiltradas} programaId={programaId} onEstadoChange={handleEstadoChange} />
            )}
            {vista === "tecnico" && (
              <VistaTecnico
                ots={otsFiltradas} programaId={programaId} onEstadoChange={handleEstadoChange}
                fechasDias={fechasDias} filtroTecnico={filtroTecnico}
              />
            )}
          </div>
        </div>
      )}

      {showCSV && (
        <CargaCSVModal
          semana={semana} anio={anio} disciplina={areaActiva ? areaToDisciplina(areaActiva.codigo) : "INST"} areaCodigo={areaActiva?.codigo ?? ""} subidoPor={user?.nombre ?? "system"}
          onClose={() => setShowCSV(false)}
          onSuccess={() => { setShowCSV(false); cargarPrograma(); }}
        />
      )}
    </div>
  );
}
