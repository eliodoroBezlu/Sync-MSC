"use client";

import React, { useState, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { tipoOtDisplay } from "@/lib/tiposOt";

// ─── Types ───────────────────────────────────────────────────────────────────

type TurnoTipo = "Diurno" | "Nocturno" | "Parada de Planta" | "Otro";
type Prioridad = "URGENTE" | "PLANIFICAR" | "SEGUIMIENTO" | "SEGURIDAD";

type Recomendacion = { prioridad: Prioridad; area?: string; tag?: string; descripcion: string };

type ResumenEjecutivo = {
  totalOTs: number; concluidas: number; pendientes: number; inconclusas: number;
  hhTotales: number; hhCorrectivo: number; hhPreventivo: number;
};

type ReporteDoc = {
  _id: string;
  turno: TurnoTipo;
  fecha: string;
  supervisorId: string;
  supervisorNombre: string;
  otIds: string[];
  otsCriticas: string[];
  otsPendientesSiguienteTurno: string[];
  notasOTs: { otId: string; nota: string }[];
  resumenEjecutivo: ResumenEjecutivo;
  recomendaciones: Recomendacion[];
  estado: "borrador" | "enviado";
  createdAt?: string;
};

type OTItem = {
  _id: string; numeroOT: string; fecha: string; turno: string; areaCodigo: string;
  tecnicos: { nombreCompleto: string }[];
  lineas: { tag: string; tipoOT: string; tiempoRealHrs?: number; descripcionEquipo?: string; sintoma?: string; resolucionAplicada?: string }[];
  estado: string;
  // Campos adicionales para OTs del plan semanal
  fromPlan?: boolean;
  heredada?: boolean;         // Marcada como "pasar a noche" por supervisor diurno
  disciplina?: string;
  grupo?: string;
  descripcion?: string;
  personas?: number;
  hrsTrabajo?: number;
  hhTotal?: number;
  tipoOT?: string;
  ordenTrabajoId?: string | null;
  ordenTrabajoNum?: string | null;
  pasarNocheMotivo?: string;
  pasarNocheNota?: string;
  pasarNochePor?: string;
  otJdeNumero?: string | null;
};

type UserOpt = { _id: string; nombreCompleto: string };

type FormData = {
  fecha: string; turno: TurnoTipo | "";
  supervisorId: string; supervisorNombre: string;
  otIds: string[]; otsCriticas: string[]; otsPendientesSiguienteTurno: string[];
  notasOTs: Record<string, string>; // otId -> nota
  recomendaciones: Recomendacion[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const TURNOS: TurnoTipo[] = ["Diurno", "Nocturno", "Parada de Planta", "Otro"];

const PRIOR_COLOR: Record<Prioridad, string> = {
  URGENTE: "#dc2626", PLANIFICAR: "#2563eb", SEGUIMIENTO: "#16a34a", SEGURIDAD: "#d97706",
};
const PRIOR_ICON: Record<Prioridad, string> = {
  URGENTE: "🚨", PLANIFICAR: "📋", SEGUIMIENTO: "👁", SEGURIDAD: "⚠️",
};

const ESTADO_COLOR: Record<string, string> = {
  borrador: "#64748b", pendiente_revision: "#d97706",
  solicitar_correccion: "#dc2626", revisado: "#2563eb", concluido: "#16a34a",
};
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador", pendiente_revision: "Pend. revisión",
  solicitar_correccion: "Corrección", revisado: "Revisado", concluido: "Concluido",
};
function tipoColor(tipoOT: string): string {
  return tipoOtDisplay(tipoOT).color.color;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  page:  { minHeight: "100vh", background: "#f1f5f9" },
  wrap:  { maxWidth: 800, margin: "0 auto", padding: "20px 16px 56px" },
  card:  { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 12 },
  label: { display: "block" as const, fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 5 },
  input: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white" },
  select: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white", cursor: "pointer" },
  textarea: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 52, background: "white" },
  badge: (color: string) => ({ display: "inline-block" as const, background: color + "18", color, border: `1px solid ${color}40`, borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" as const }),
  btnPrimary: { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGreen:   { background: "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGhost:   { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const },
  btnOutline: { background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" as const },
  metricCard: (color: string) => ({ background: color + "0d", border: `1px solid ${color}30`, borderRadius: 10, padding: "14px 16px", textAlign: "center" as const }),
};

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = [{ n: 1, label: "Encabezado" }, { n: 2, label: "OTs" }, { n: 3, label: "Recomend." }, { n: 4, label: "Revisión" }];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12px 0 20px" }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: step > s.n ? "#2563eb" : step === s.n ? "#1d4ed8" : "#e2e8f0", color: step >= s.n ? "white" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, boxShadow: step === s.n ? "0 0 0 4px #2563eb25" : "none" }}>
              {step > s.n ? "✓" : s.n}
            </div>
            <span style={{ fontSize: 10, color: step >= s.n ? "#2563eb" : "#94a3b8", fontWeight: 600 }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div style={{ width: 52, height: 2, background: step > s.n ? "#2563eb" : "#e2e8f0", margin: "0 4px 14px" }} />}
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Turnos: Diurno 06:30–18:29 · Nocturno 18:30–06:29 (cruza medianoche)
function getFechaTurno() {
  const ahora = new Date();
  const min = ahora.getHours() * 60 + ahora.getMinutes();
  if (min >= 18 * 60 + 30) {
    return { fecha: localDateStr(ahora), turno: "Nocturno" as const };
  } else if (min < 6 * 60 + 30) {
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    return { fecha: localDateStr(ayer), turno: "Nocturno" as const };
  }
  return { fecha: localDateStr(ahora), turno: "Diurno" as const };
}

export default function ReporteTurnoPage() {
  const { user } = useUser();
  const { fecha: shiftFecha, turno: shiftTurno } = getFechaTurno();
  const today = new Date().toISOString().split("T")[0];

  const [view, setView]       = useState<"lista" | "nuevo" | "detalle">("lista");
  const [step, setStep]       = useState(1);
  const [detalle, setDetalle] = useState<ReporteDoc | null>(null);

  const [reportes, setReportes]       = useState<ReporteDoc[]>([]);
  const [supervisores, setSupervisores] = useState<UserOpt[]>([]);
  const [otsDisponibles, setOtsDisponibles] = useState<OTItem[]>([]);
  const [loadingReportes, setLoadingReportes] = useState(true);
  const [loadingOTs, setLoadingOTs]   = useState(false);

  // detalle: OTs completas para la vista de detalle
  const [detalleOTs, setDetalleOTs]   = useState<OTItem[]>([]);

  const [form, setForm] = useState<FormData>({
    fecha: shiftFecha, turno: shiftTurno,
    supervisorId: "", supervisorNombre: "",
    otIds: [], otsCriticas: [], otsPendientesSiguienteTurno: [],
    notasOTs: {}, recomendaciones: [],
  });
  const [recInput, setRecInput] = useState<{ prioridad: Prioridad; area: string; tag: string; descripcion: string }>({ prioridad: "PLANIFICAR", area: "", tag: "", descripcion: "" });
  const [recEditIdx, setRecEditIdx] = useState<number | null>(null); // índice de la recomendación en edición
  const [todosLosTags, setTodosLosTags] = useState<string[]>([]);
  const [filtroTexto, setFiltroTexto]   = useState("");
  const [filtroEstado, setFiltroEstado] = useState<string>("");
  const [errs, setErrs]         = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr]   = useState("");

  const [filtroListaEstado, setFiltroListaEstado] = useState("");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  // Edición de recomendaciones en vista detalle
  const [editandoRecs, setEditandoRecs] = useState(false);
  const [recsEditables, setRecsEditables] = useState<Recomendacion[]>([]);
  const [tagQueryDetalle, setTagQueryDetalle] = useState<Record<number, string>>({});
  const [tagDropDetalle, setTagDropDetalle] = useState<number | null>(null);

  // ─── Load data ─────────────────────────────────────────────────────────────

  const loadReportes = useCallback(async () => {
    setLoadingReportes(true);
    const params = new URLSearchParams({ tipo: "supervisor", limit: "80" });
    if (filtroListaEstado) params.set("estado", filtroListaEstado);
    const data = await fetch(`/api/reportes-turno?${params}`).then((r) => r.json()).catch(() => []);
    setReportes(Array.isArray(data) ? data : []);
    setLoadingReportes(false);
  }, [filtroListaEstado]);

  useEffect(() => {
    fetch("/api/usuarios?rol=3").then((r) => r.json()).then(setSupervisores).catch(() => {});
  }, []);

  useEffect(() => { loadReportes(); }, [loadReportes]);

  // Cargar OTs cuando cambia fecha o turno — combina OTs internas + plan semanal
  useEffect(() => {
    if (!form.fecha || !form.turno) { setOtsDisponibles([]); return; }
    setLoadingOTs(true);

    const params = new URLSearchParams({ turno: form.turno, fecha: form.fecha, limit: "200" });
    const planParams = new URLSearchParams({ turno: form.turno, fecha: form.fecha });

    Promise.all([
      fetch(`/api/ordenes?${params}`).then((r) => r.json()).catch(() => []),
      fetch(`/api/plan-turno?${planParams}`).then((r) => r.json()).catch(() => []),
    ]).then(([internas, plan]) => {
      const otInternas: OTItem[] = Array.isArray(internas) ? internas : [];
      const otPlan: OTItem[]     = Array.isArray(plan) ? plan : [];

      // Excluir del plan las que ya tienen OT interna vinculada (para no duplicar)
      const idsVinculados = new Set(otInternas.map((o) => o.numeroOT));
      const planSinDuplicar = otPlan.filter(
        (o) => !o.ordenTrabajoId && !idsVinculados.has(o.numeroOT)
      );

      // Primero las OTs internas (ya ejecutadas), luego las del plan
      setOtsDisponibles([...otInternas, ...planSinDuplicar]);
    }).finally(() => setLoadingOTs(false));
  }, [form.fecha, form.turno]);

  // Cargar todos los TAGs del catálogo de equipos (una sola vez al montar)
  useEffect(() => {
    fetch("/api/plan-turno/tags")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTodosLosTags(data); })
      .catch(() => {});
  }, []);

  // Pre-rellenar supervisor con el usuario logueado (si es supervisor)
  useEffect(() => {
    if (user && user.rol <= 3 && !form.supervisorId) {
      setForm((f) => ({ ...f, supervisorId: user.id, supervisorNombre: user.nombre }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function patchForm(p: Partial<FormData>) { setForm((f) => ({ ...f, ...p })); }

  const otsSeleccionadas = otsDisponibles.filter((o) => form.otIds.includes(o._id));

  // OTs reactivas vinculadas a OPEPLANT (registradas por turneros ELEC/INST)
  const otsTurnero = otsDisponibles.filter(o => o.otJdeNumero && !o.fromPlan);
  // OTs del plan y reactivas sin OPEPLANT (mecánica, etc.)
  const otsNoTurnero = otsDisponibles.filter(o => !o.otJdeNumero || o.fromPlan);

  const otsFiltradas = otsNoTurnero.filter((o) => {
    const matchEstado = !filtroEstado || o.estado === filtroEstado;
    const txt = filtroTexto.toLowerCase();
    const matchTxt = !txt || o.numeroOT.toLowerCase().includes(txt)
      || (o.otJdeNumero ?? "").toLowerCase().includes(txt)
      || o.areaCodigo.toLowerCase().includes(txt)
      || o.lineas.some((l) => l.tag.toLowerCase().includes(txt))
      || o.tecnicos.some((t) => t.nombreCompleto.toLowerCase().includes(txt));
    return matchEstado && matchTxt;
  });

  function toggleOT(id: string) {
    const has = form.otIds.includes(id);
    const otIds = has ? form.otIds.filter((x) => x !== id) : [...form.otIds, id];
    const otsCriticas = form.otsCriticas.filter((x) => otIds.includes(x));
    const otsPendientesSiguienteTurno = form.otsPendientesSiguienteTurno.filter((x) => otIds.includes(x));
    const notasOTs = { ...form.notasOTs };
    if (has) delete notasOTs[id];
    patchForm({ otIds, otsCriticas, otsPendientesSiguienteTurno, notasOTs });
  }

  function toggleCritica(id: string) {
    patchForm({ otsCriticas: form.otsCriticas.includes(id) ? form.otsCriticas.filter((x) => x !== id) : [...form.otsCriticas, id] });
  }

  function togglePendiente(id: string) {
    patchForm({ otsPendientesSiguienteTurno: form.otsPendientesSiguienteTurno.includes(id) ? form.otsPendientesSiguienteTurno.filter((x) => x !== id) : [...form.otsPendientesSiguienteTurno, id] });
  }

  function setNotaOT(id: string, nota: string) {
    patchForm({ notasOTs: { ...form.notasOTs, [id]: nota } });
  }

  function addRecomendacion() {
    if (!recInput.descripcion.trim()) return;
    const tagFinal = (recInput.tag || tagQuery).trim().toUpperCase() || undefined;
    const nueva = {
      prioridad: recInput.prioridad,
      area: recInput.area.trim() || undefined,
      tag: tagFinal,
      descripcion: recInput.descripcion.trim(),
    };
    if (recEditIdx !== null) {
      patchForm({ recomendaciones: form.recomendaciones.map((r, i) => i === recEditIdx ? nueva : r) });
      setRecEditIdx(null);
    } else {
      patchForm({ recomendaciones: [...form.recomendaciones, nueva] });
    }
    setTagQuery("");
    setTagDropdownOpen(false);
    setRecInput({ prioridad: recInput.prioridad, area: "", tag: "", descripcion: "" });
  }

  function editarRecomendacion(i: number) {
    const r = form.recomendaciones[i];
    setRecInput({ prioridad: r.prioridad, area: r.area ?? "", tag: r.tag ?? "", descripcion: r.descripcion });
    setTagQuery("");
    setRecEditIdx(i);
  }

  function cancelarEdicion() {
    setRecEditIdx(null);
    setTagQuery("");
    setRecInput({ prioridad: "PLANIFICAR", area: "", tag: "", descripcion: "" });
  }

  function removeRec(idx: number) {
    patchForm({ recomendaciones: form.recomendaciones.filter((_, i) => i !== idx) });
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!form.fecha) e.fecha = "Seleccione la fecha";
    if (!form.turno) e.turno = "Seleccione el turno";
    if (!form.supervisorNombre.trim()) e.supervisor = "Ingrese el nombre del supervisor";
    setErrs(e); return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e: Record<string, string> = {};
    if (form.otIds.length === 0) e.ots = "Seleccione al menos una OT para incluir en el reporte";
    setErrs(e); return Object.keys(e).length === 0;
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function submit(estado: "borrador" | "enviado") {
    setSubmitting(true); setSubmitErr("");
    try {
      const notasOTsArr = Object.entries(form.notasOTs)
        .filter(([, nota]) => nota.trim())
        .map(([otId, nota]) => ({ otId, nota: nota.trim() }));

      // Serializar OTs del plan (IDs con prefijo "plan-") para guardarlas inline
      const otsPlanData = form.otIds
        .filter(id => id.startsWith("plan-"))
        .map(id => {
          const ot = otsDisponibles.find(o => o._id === id);
          if (!ot) return null;
          return {
            otId: id,
            numeroOT: ot.numeroOT,
            tag: ot.lineas[0]?.tag ?? "",
            disciplina: ot.disciplina ?? "",
            grupo: ot.grupo ?? "",
            tipoOT: ot.tipoOT ?? ot.lineas[0]?.tipoOT ?? "",
            descripcion: ot.descripcion ?? ot.lineas[0]?.sintoma ?? "",
            tecnicos: ot.tecnicos.map(t => t.nombreCompleto),
            hhTotal: ot.hhTotal ?? 0,
            estado: ot.estado,
            heredada: ot.heredada ?? false,
            pasarNocheMotivo: ot.pasarNocheMotivo ?? "",
            pasarNochePor: ot.pasarNochePor ?? "",
          };
        }).filter(Boolean);

      const payload = {
        tipo: "supervisor",
        turno: form.turno,
        fecha: form.fecha,
        supervisorId: form.supervisorId,
        supervisorNombre: form.supervisorNombre,
        otIds: form.otIds,
        otsCriticas: form.otsCriticas,
        otsPendientesSiguienteTurno: form.otsPendientesSiguienteTurno,
        notasOTs: notasOTsArr,
        otsPlanData,
        recomendaciones: form.recomendaciones,
        estado,
      };
      const res = await fetch("/api/reportes-turno", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      // Cargar OTs completas para el detalle
      await loadDetalleOTs(data.reporte.otIds);
      setDetalle(data.reporte);
      setView("detalle");
      loadReportes();
    } catch (e: unknown) { setSubmitErr(e instanceof Error ? e.message : "Error"); }
    finally { setSubmitting(false); }
  }

  async function guardarRecsEditadas(id: string) {
    await fetch(`/api/reportes-turno/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recomendaciones: recsEditables }),
    });
    setDetalle(prev => prev ? { ...prev, recomendaciones: recsEditables } : prev);
    setEditandoRecs(false);
  }

  async function enviarReporte(id: string) {
    const res = await fetch(`/api/reportes-turno/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "enviado" }),
    });
    const data = await res.json();
    if (res.ok) { setDetalle(data.reporte); loadReportes(); }
  }

  async function loadDetalleOTs(ids: string[]) {
    if (!ids?.length) { setDetalleOTs([]); return; }
    const params = new URLSearchParams({ limit: "200" });
    // Fetch individual OTs by fetching all and filtering client-side
    const data = await fetch(`/api/ordenes?${params}`).then((r) => r.json()).catch(() => []);
    const all: OTItem[] = Array.isArray(data) ? data : [];
    setDetalleOTs(all.filter((o) => ids.includes(o._id)));
  }

  async function eliminarReporte(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm("¿Eliminar este reporte? Esta acción no se puede deshacer.")) return;
    await fetch(`/api/reportes-turno/${id}`, { method: "DELETE" });
    loadReportes();
  }

  function abrirDetalle(r: ReporteDoc) {
    setDetalle(r);
    loadDetalleOTs(r.otIds);
    setView("detalle");
  }

  function resetForm() {
    const { fecha, turno } = getFechaTurno();
    setForm({
      fecha, turno,
      supervisorId: user?.rol !== undefined && user.rol <= 3 ? user.id : "",
      supervisorNombre: user?.rol !== undefined && user.rol <= 3 ? user.nombre : "",
      otIds: [], otsCriticas: [], otsPendientesSiguienteTurno: [],
      notasOTs: {}, recomendaciones: [],
    });
    setStep(1); setErrs({}); setSubmitErr(""); setFiltroTexto(""); setFiltroEstado("");
  }

  // ─── VISTA LISTA ─────────────────────────────────────────────────────────────

  if (view === "lista") {
    return (
      <div style={S.page}>
        <AppHeader backHref="/ordenes" />
        <div style={S.wrap}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 10 }}>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 2 }}>Reporte de Turno</h1>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Shift Handover — Consolidado de todas las áreas</p>
            </div>
            <button onClick={() => { resetForm(); setView("nuevo"); }} style={S.btnPrimary}>
              + Nuevo reporte
            </button>
          </div>

          {/* Filtro */}
          <div style={{ ...S.card, padding: "12px 16px", marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Estado</label>
                <select value={filtroListaEstado} onChange={(e) => setFiltroListaEstado(e.target.value)} style={S.select}>
                  <option value="">Todos</option>
                  <option value="borrador">Borrador</option>
                  <option value="enviado">Enviado</option>
                </select>
              </div>
              <button onClick={loadReportes} style={{ ...S.btnGhost, marginTop: 18, padding: "9px 14px", fontSize: 12 }}>↻</button>
            </div>
          </div>

          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
            {loadingReportes ? "Cargando…" : `${reportes.length} reporte(s)`}
          </p>

          {loadingReportes ? (
            <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>Cargando…</div>
          ) : reportes.length === 0 ? (
            <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
              <p style={{ color: "#94a3b8", fontSize: 14 }}>No hay reportes de turno. Cree el primero.</p>
            </div>
          ) : (
            reportes.map((r) => {
              const enviado = r.estado === "enviado";
              return (
                <div
                  key={r._id}
                  onClick={() => abrirDetalle(r)}
                  style={{ ...S.card, borderLeft: `4px solid ${enviado ? "#16a34a" : "#64748b"}`, cursor: "pointer" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.09)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: 15, color: "#0f2847" }}>
                          {new Date(r.fecha).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
                        </span>
                        <span style={S.badge(enviado ? "#16a34a" : "#64748b")}>{enviado ? "Enviado" : "Borrador"}</span>
                        <span style={S.badge(r.turno === "Nocturno" ? "#7c3aed" : "#0891b2")}>{r.turno}</span>
                      </div>
                      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>Supervisor: {r.supervisorNombre}</p>
                      <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#94a3b8", flexWrap: "wrap" }}>
                        <span>{r.otIds.length} OTs incluidas</span>
                        <span>{r.resumenEjecutivo.hhTotales}h totales</span>
                        <span>{r.resumenEjecutivo.concluidas} concluidas</span>
                        {r.otsCriticas.length > 0 && <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠ {r.otsCriticas.length} crítica(s)</span>}
                        {r.otsPendientesSiguienteTurno.length > 0 && <span style={{ color: "#d97706", fontWeight: 700 }}>→ {r.otsPendientesSiguienteTurno.length} pendiente(s)</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>Ver →</span>
                      <a
                        href={`/ordenes/turno/${r._id}/imprimir`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textDecoration: "none" }}>
                        🖨 PDF
                      </a>
                      {user && Number(user.rol) === 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); abrirDetalle(r); }}
                          title="Editar reporte"
                          style={{ fontSize: 11, color: "#d97706", background: "none", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                          ✏ Editar
                        </button>
                      )}
                      {user && Number(user.rol) === 1 && (
                        <button
                          onClick={(e) => eliminarReporte(e, r._id)}
                          title="Eliminar reporte"
                          style={{ fontSize: 11, color: "#dc2626", background: "none", border: "1px solid #fecaca", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                          🗑 Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ─── VISTA NUEVO (wizard) ─────────────────────────────────────────────────────

  if (view === "nuevo") {
    return (
      <div style={S.page}>
        <AppHeader backHref="/ordenes" />
        <div style={S.wrap}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 2 }}>Nuevo Reporte de Turno</h1>
          <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 0 }}>Consolidado de toda la planta</p>
          <StepIndicator step={step} />

          {/* ── Step 1: Encabezado ── */}
          {step === 1 && (
            <>
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 18 }}>Datos del turno</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <div>
                    <label style={S.label}>Fecha</label>
                    <input type="date" value={form.fecha} onChange={(e) => patchForm({ fecha: e.target.value })} style={S.input} />
                    {errs.fecha && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{errs.fecha}</p>}
                  </div>
                  <div>
                    <label style={S.label}>Turno</label>
                    <select value={form.turno} onChange={(e) => patchForm({ turno: e.target.value as TurnoTipo })} style={S.select}>
                      <option value="">— Seleccionar —</option>
                      {TURNOS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {errs.turno && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{errs.turno}</p>}
                  </div>
                </div>

                <div>
                  <label style={S.label}>Supervisor responsable del turno</label>
                  {supervisores.length > 0 ? (
                    <select
                      value={form.supervisorId}
                      onChange={(e) => {
                        const sel = supervisores.find((s) => s._id === e.target.value);
                        patchForm({ supervisorId: e.target.value, supervisorNombre: sel?.nombreCompleto ?? "" });
                      }}
                      style={S.select}
                    >
                      <option value="">— Seleccionar supervisor —</option>
                      {supervisores.map((s) => <option key={s._id} value={s._id}>{s.nombreCompleto}</option>)}
                    </select>
                  ) : (
                    <input value={form.supervisorNombre} onChange={(e) => patchForm({ supervisorNombre: e.target.value })} placeholder="Nombre del supervisor" style={S.input} />
                  )}
                  {errs.supervisor && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{errs.supervisor}</p>}
                </div>

                {form.turno && form.fecha && (
                  <div style={{ marginTop: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" }}>
                    <p style={{ fontSize: 12, color: "#64748b" }}>
                      Se cargarán las OTs de <strong>turno {form.turno}</strong> del <strong>{form.fecha}</strong> de <strong>todas las áreas de la planta</strong>.
                    </p>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => { if (validateStep1()) setStep(2); }} style={S.btnPrimary}>Continuar →</button>
              </div>
            </>
          )}

          {/* ── Step 2: OTs del turno ── */}
          {step === 2 && (
            <>
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847" }}>OTs del turno — Todas las áreas</div>
                    <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                      {form.turno} · {form.fecha} · {form.otIds.length} seleccionadas para el reporte
                    </p>
                  </div>
                  {loadingOTs && <span style={{ fontSize: 12, color: "#94a3b8" }}>Cargando…</span>}
                </div>

                {/* ── Banner OTs heredadas del turno diurno ── */}
                {form.turno === "Nocturno" && (() => {
                  const heredadas = otsDisponibles.filter(o => o.heredada);
                  if (!heredadas.length) return null;
                  return (
                    <div style={{ background: "#faf5ff", border: "1px solid #c4b5fd", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 16 }}>🌙</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#7c3aed" }}>
                          {heredadas.length} OT{heredadas.length !== 1 ? "s" : ""} heredada{heredadas.length !== 1 ? "s" : ""} del turno Diurno
                        </span>
                        <button
                          onClick={() => {
                            const ids = heredadas.map(o => o._id).filter(id => !form.otIds.includes(id));
                            if (ids.length) patchForm({ otIds: [...form.otIds, ...ids] });
                          }}
                          style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 6, border: "none", background: "#7c3aed", color: "white", cursor: "pointer" }}>
                          + Agregar todas al reporte
                        </button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                        {heredadas.map(o => (
                          <div key={o._id} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "white", borderRadius: 8, padding: "8px 10px", border: "1px solid #ede9fe" }}>
                            <input type="checkbox" checked={form.otIds.includes(o._id)} onChange={() => toggleOT(o._id)}
                              style={{ marginTop: 2, accentColor: "#7c3aed", cursor: "pointer" }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
                                <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: "#0f2847" }}>{o.otJdeNumero ?? o.numeroOT}</span>
                                {o.disciplina && <span style={{ fontSize: 10, fontWeight: 700, background: "#e0f2fe", color: "#0369a1", padding: "1px 6px", borderRadius: 4 }}>{o.disciplina}</span>}
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8" }}>{o.lineas[0]?.tag}</span>
                                {o.hhTotal && <span style={{ fontSize: 11, color: "#64748b" }}>{o.hhTotal}HH</span>}
                              </div>
                              <p style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{o.descripcion}</p>
                              {o.pasarNocheMotivo && (
                                <p style={{ fontSize: 10, color: "#7c3aed", marginTop: 2 }}>
                                  📌 {o.pasarNocheMotivo}{o.pasarNocheNota ? ` — ${o.pasarNocheNota}` : ""}{o.pasarNochePor ? ` · por ${o.pasarNochePor}` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Sección OTs Turnero ELEC/INST (solo turno Nocturno) ── */}
                {form.turno === "Nocturno" && (() => {
                  if (loadingOTs) return null;
                  if (otsTurnero.length === 0) return (
                    <div style={{ background: "#fafafa", border: "1px dashed #fcd34d", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15 }}>⚡</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>OTs Turnero ELEC / INST</span>
                        <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>Sin registros aún para esta noche</span>
                      </div>
                    </div>
                  );

                  // Agrupar por otJdeNumero (una caja por OPEPLANT)
                  const porOpeplant: Record<string, OTItem[]> = {};
                  for (const ot of otsTurnero) {
                    const key = ot.otJdeNumero ?? "—";
                    if (!porOpeplant[key]) porOpeplant[key] = [];
                    porOpeplant[key].push(ot);
                  }
                  const hhTurnero = otsTurnero.reduce((s, o) => s + o.lineas.reduce((a, l) => a + (l.tiempoRealHrs ?? 0), 0), 0);
                  const selTurnero = otsTurnero.filter(o => form.otIds.includes(o._id)).length;

                  return (
                    <div style={{ background: "#fffbeb", border: "2px solid #fcd34d", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                      {/* Header sección */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 16 }}>⚡</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 800, fontSize: 13, color: "#92400e" }}>OTs Turnero ELEC / INST</span>
                          <span style={{ fontSize: 11, color: "#b45309", marginLeft: 8 }}>
                            {otsTurnero.length} OT{otsTurnero.length !== 1 ? "s" : ""} · {Math.round(hhTurnero * 10) / 10}HH registradas esta noche
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const ids = otsTurnero.map(o => o._id).filter(id => !form.otIds.includes(id));
                            if (ids.length) patchForm({ otIds: [...form.otIds, ...ids] });
                          }}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 6, border: "none", background: "#d97706", color: "white", cursor: "pointer", whiteSpace: "nowrap" as const }}>
                          + Agregar todas ({otsTurnero.length - selTurnero} pendientes)
                        </button>
                      </div>

                      {/* Grupos por OPEPLANT */}
                      {Object.entries(porOpeplant).map(([opeplant, ots]) => {
                        const hhOp = ots.reduce((s, o) => s + o.lineas.reduce((a, l) => a + (l.tiempoRealHrs ?? 0), 0), 0);
                        return (
                          <div key={opeplant} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4, padding: "2px 8px", fontFamily: "monospace" }}>
                                OPEPLANT {opeplant}
                              </span>
                              <span style={{ color: "#b45309" }}>{ots.length} OT{ots.length !== 1 ? "s" : ""} · {Math.round(hhOp * 10) / 10}HH</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                              {ots.map(ot => {
                                const sel = form.otIds.includes(ot._id);
                                const crit = form.otsCriticas.includes(ot._id);
                                const pend = form.otsPendientesSiguienteTurno.includes(ot._id);
                                const estadoColor = ESTADO_COLOR[ot.estado] ?? "#64748b";
                                const hhOT = ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
                                return (
                                  <div key={ot._id} style={{ borderRadius: 8, background: sel ? "#fef9c3" : "white", border: `1px solid ${sel ? "#fcd34d" : "#e2e8f0"}` }}>
                                    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 72px 80px", gap: 6, alignItems: "center", padding: "9px 8px" }}>
                                      <input type="checkbox" checked={sel} onChange={() => toggleOT(ot._id)} style={{ width: 16, height: 16, accentColor: "#d97706", cursor: "pointer" }} />
                                      <div>
                                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 2 }}>
                                          <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{ot.otJdeNumero ?? ot.numeroOT}</span>
                                          {ot.areaCodigo && <span style={S.badge("#475569")}>{ot.areaCodigo}</span>}
                                          <span style={S.badge(estadoColor)}>{ESTADO_LABEL[ot.estado] ?? ot.estado}</span>
                                          {ot.lineas.map((l, i) => <span key={i} style={S.badge(tipoColor(l.tipoOT))}>{tipoOtDisplay(l.tipoOT).texto}</span>)}
                                          {hhOT > 0 && <span style={{ fontSize: 11, color: "#d97706", fontWeight: 700 }}>{Math.round(hhOT * 10) / 10}HH</span>}
                                        </div>
                                        <p style={{ fontSize: 11, color: "#64748b", marginBottom: 1 }}>{ot.tecnicos.map(t => t.nombreCompleto).join(" / ")}</p>
                                        <p style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600 }}>{ot.lineas.map(l => l.tag).join(", ")}</p>
                                        {ot.lineas[0]?.sintoma && <p style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 1 }}>{ot.lineas[0].sintoma}</p>}
                                      </div>
                                      <div style={{ textAlign: "center" }}>
                                        <button type="button" disabled={!sel} onClick={() => toggleCritica(ot._id)}
                                          style={{ background: crit ? "#fee2e2" : sel ? "#fef9c3" : "#f8fafc", border: `1px solid ${crit ? "#fca5a5" : "#e2e8f0"}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: sel ? "pointer" : "not-allowed", color: crit ? "#dc2626" : "#94a3b8", fontWeight: crit ? 700 : 400 }}>
                                          {crit ? "⚠ Sí" : "⚠"}
                                        </button>
                                      </div>
                                      <div style={{ textAlign: "center" }}>
                                        <button type="button" disabled={!sel} onClick={() => togglePendiente(ot._id)}
                                          style={{ background: pend ? "#fef3c7" : sel ? "#fef9c3" : "#f8fafc", border: `1px solid ${pend ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: sel ? "pointer" : "not-allowed", color: pend ? "#d97706" : "#94a3b8", fontWeight: pend ? 700 : 400 }}>
                                          {pend ? "→ Sí" : "→"}
                                        </button>
                                      </div>
                                    </div>
                                    {sel && (
                                      <div style={{ padding: "0 8px 10px 40px", borderTop: "1px solid #fde68a" }}>
                                        <label style={{ ...S.label, marginTop: 8 }}>Notas del supervisor</label>
                                        <textarea
                                          value={form.notasOTs[ot._id] ?? ""}
                                          onChange={(e) => setNotaOT(ot._id, e.target.value)}
                                          placeholder="Observaciones sobre esta OT turnero…"
                                          style={S.textarea}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* ── Separador antes de OTs mecánica/plan ── */}
                {form.turno === "Nocturno" && otsNoTurnero.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" as const }}>
                      🔧 OTs Mecánica / Programadas
                    </span>
                    <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
                  </div>
                )}

                {/* Filtros inline */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 8, marginBottom: 12 }}>
                  <input
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                    placeholder="Buscar por OT, TAG, área, técnico…"
                    style={S.input}
                  />
                  <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={S.select}>
                    <option value="">Todos los estados</option>
                    <option value="borrador">Borrador</option>
                    <option value="pendiente_revision">Pend. revisión</option>
                    <option value="revisado">Revisado</option>
                    <option value="concluido">Concluido</option>
                    <option value="solicitar_correccion">Corrección</option>
                  </select>
                </div>

                {loadingOTs && (
                  <div style={{ textAlign: "center", padding: "24px 0", color: "#94a3b8", fontSize: 13 }}>
                    Cargando OTs del turno y programación semanal…
                  </div>
                )}
                {!loadingOTs && otsDisponibles.length === 0 && (
                  <div style={{ textAlign: "center", padding: "24px 0", color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
                    No se encontraron OTs para turno {form.turno} del {form.fecha}.<br />
                    Verifique que la programación semanal esté cargada para esa semana.
                  </div>
                )}

                {otsFiltradas.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Encabezado columnas */}
                    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 72px 80px", gap: 6, padding: "2px 6px" }}>
                      <div />
                      <span style={{ ...S.label, marginBottom: 0 }}>OT / Área / Técnicos / TAGs</span>
                      <span style={{ ...S.label, marginBottom: 0, textAlign: "center" as const }}>⚠ Crítica</span>
                      <span style={{ ...S.label, marginBottom: 0, textAlign: "center" as const }}>→ Sig.turno</span>
                    </div>

                    {otsFiltradas.map((ot) => {
                      const sel  = form.otIds.includes(ot._id);
                      const crit = form.otsCriticas.includes(ot._id);
                      const pend = form.otsPendientesSiguienteTurno.includes(ot._id);
                      const estadoColor = ESTADO_COLOR[ot.estado] ?? "#64748b";
                      const esPlan = ot.fromPlan === true;
                      return (
                        <div key={ot._id} style={{ borderRadius: 10, background: sel ? "#f0f7ff" : esPlan ? "#f9fafb" : "#fafafa", border: `1px solid ${sel ? "#bfdbfe" : esPlan ? "#e2e8f0" : "#f1f5f9"}` }}>
                          {/* Fila principal */}
                          <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 72px 80px", gap: 6, alignItems: "center", padding: "10px 8px" }}>
                            <input type="checkbox" checked={sel} onChange={() => toggleOT(ot._id)} style={{ width: 16, height: 16, accentColor: "#2563eb", cursor: "pointer" }} />
                            <div>
                              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                                <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{ot.otJdeNumero ?? ot.numeroOT}</span>
                                {esPlan && (
                                  <span style={{ fontSize: 9, fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 5px" }}>
                                    PLAN
                                  </span>
                                )}
                                {ot.disciplina && <span style={S.badge("#0891b2")}>{ot.disciplina}</span>}
                                {!ot.disciplina && ot.areaCodigo && <span style={S.badge("#475569")}>{ot.areaCodigo}</span>}
                                {ot.grupo && <span style={S.badge(ot.grupo === "Nocturno" ? "#7c3aed" : "#475569")}>{ot.grupo}</span>}
                                <span style={S.badge(estadoColor)}>{esPlan ? (ot.estado === "no_iniciada" ? "Sin iniciar" : ot.estado) : (ESTADO_LABEL[ot.estado] ?? ot.estado)}</span>
                                {ot.lineas.map((l, i) => <span key={i} style={S.badge(tipoColor(l.tipoOT))}>{tipoOtDisplay(l.tipoOT).texto}</span>)}
                                {esPlan && ot.hhTotal && <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{ot.hhTotal}HH</span>}
                              </div>
                              <p style={{ fontSize: 11, color: "#64748b", marginBottom: 1 }}>{ot.tecnicos.map((t) => t.nombreCompleto).join(" / ")}</p>
                              <p style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600 }}>{ot.lineas.map((l) => l.tag).join(", ")}</p>
                              {(ot.lineas[0]?.sintoma || ot.descripcion) && (
                                <p style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginTop: 1 }}>
                                  {ot.lineas[0]?.sintoma || ot.descripcion}
                                </p>
                              )}
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <button type="button" disabled={!sel} onClick={() => toggleCritica(ot._id)}
                                style={{ background: crit ? "#fee2e2" : sel ? "#f1f5f9" : "#f8fafc", border: `1px solid ${crit ? "#fca5a5" : "#e2e8f0"}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: sel ? "pointer" : "not-allowed", color: crit ? "#dc2626" : "#94a3b8", fontWeight: crit ? 700 : 400 }}>
                                {crit ? "⚠ Sí" : "⚠"}
                              </button>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <button type="button" disabled={!sel} onClick={() => togglePendiente(ot._id)}
                                style={{ background: pend ? "#fef3c7" : sel ? "#f1f5f9" : "#f8fafc", border: `1px solid ${pend ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: sel ? "pointer" : "not-allowed", color: pend ? "#d97706" : "#94a3b8", fontWeight: pend ? 700 : 400 }}>
                                {pend ? "→ Sí" : "→"}
                              </button>
                            </div>
                          </div>

                          {/* Notas del supervisor (solo si está seleccionada) */}
                          {sel && (
                            <div style={{ padding: "0 8px 10px 40px", borderTop: "1px solid #e2e8f0" }}>
                              <label style={{ ...S.label, marginTop: 8 }}>Notas del supervisor</label>
                              <textarea
                                value={form.notasOTs[ot._id] ?? ""}
                                onChange={(e) => setNotaOT(ot._id, e.target.value)}
                                placeholder="Observaciones, estado actual, responsable recomendado…"
                                style={S.textarea}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {errs.ots && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>{errs.ots}</p>}
              </div>

              {/* Resumen automático */}
              {otsSeleccionadas.length > 0 && (() => {
                const tot  = otsSeleccionadas.length;
                const conc = otsSeleccionadas.filter((o) => o.estado === "concluido" || o.estado === "revisado").length;
                const pend = otsSeleccionadas.filter((o) => o.estado === "pendiente_revision").length;
                const inc  = tot - conc - pend;
                const hhT  = otsSeleccionadas.reduce((s, o) => s + o.lineas.reduce((a, l) => a + (l.tiempoRealHrs ?? 0), 0), 0);
                return (
                  <div style={{ ...S.card, background: "#f8fafc" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Resumen del reporte</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                      <div style={S.metricCard("#2563eb")}><p style={{ fontSize: 20, fontWeight: 800, color: "#2563eb" }}>{tot}</p><p style={{ fontSize: 11, color: "#64748b" }}>OTs incluidas</p></div>
                      <div style={S.metricCard("#16a34a")}><p style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>{conc}</p><p style={{ fontSize: 11, color: "#64748b" }}>Concluidas</p></div>
                      <div style={S.metricCard("#d97706")}><p style={{ fontSize: 20, fontWeight: 800, color: "#d97706" }}>{pend}</p><p style={{ fontSize: 11, color: "#64748b" }}>Pendientes</p></div>
                      <div style={S.metricCard("#7c3aed")}><p style={{ fontSize: 20, fontWeight: 800, color: "#7c3aed" }}>{Math.round(hhT * 10) / 10}h</p><p style={{ fontSize: 11, color: "#64748b" }}>HH Totales</p></div>
                    </div>
                    {inc > 0 && <p style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>⚠ {inc} OT(s) inconclusa(s) / en corrección</p>}
                    {form.otsCriticas.length > 0 && <p style={{ fontSize: 12, color: "#dc2626", fontWeight: 700, marginTop: 4 }}>⚠ {form.otsCriticas.length} marcada(s) como crítica(s)</p>}
                    {form.otsPendientesSiguienteTurno.length > 0 && <p style={{ fontSize: 12, color: "#d97706", fontWeight: 700, marginTop: 4 }}>→ {form.otsPendientesSiguienteTurno.length} pendiente(s) para siguiente turno</p>}
                  </div>
                );
              })()}

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button onClick={() => setStep(1)} style={S.btnGhost}>← Volver</button>
                <button onClick={() => { if (validateStep2()) setStep(3); }} style={S.btnPrimary}>Continuar →</button>
              </div>
            </>
          )}

          {/* ── Step 3: Recomendaciones ── */}
          {step === 3 && (
            <>
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 14 }}>Recomendaciones para el siguiente turno</div>

                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px", marginBottom: 16 }}>
                  {/* Fila 1: Prioridad + Área + TAG */}
                  <div style={{ display: "grid", gridTemplateColumns: "150px 160px 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={S.label}>Prioridad</label>
                      <select value={recInput.prioridad} onChange={(e) => setRecInput((r) => ({ ...r, prioridad: e.target.value as Prioridad }))} style={S.select}>
                        {(["URGENTE", "PLANIFICAR", "SEGUIMIENTO", "SEGURIDAD"] as Prioridad[]).map((p) => (
                          <option key={p} value={p}>{PRIOR_ICON[p]} {p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.label}>Área <span style={{ fontWeight: 400, color: "#94a3b8" }}>(opcional)</span></label>
                      <select value={recInput.area} onChange={(e) => setRecInput((r) => ({ ...r, area: e.target.value }))} style={S.select}>
                        <option value="">— Seleccionar —</option>
                        {["Chancado","Molienda","Flotación","Filtros","Eléctrico","Instrumentación","Mantenimiento General","Bodega / Almacén","Operaciones"].map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ position: "relative" }}>
                      <label style={S.label}>TAG / Equipo <span style={{ fontWeight: 400, color: "#94a3b8" }}>(opcional)</span></label>
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <input
                          value={recInput.tag ? recInput.tag : tagQuery}
                          onChange={(e) => {
                            const v = e.target.value.toUpperCase();
                            setTagQuery(v);
                            setRecInput(r => ({ ...r, tag: "" }));
                            setTagDropdownOpen(v.length >= 2);
                          }}
                          onFocus={() => { if ((recInput.tag || tagQuery).length >= 2) setTagDropdownOpen(true); }}
                          onBlur={() => setTimeout(() => setTagDropdownOpen(false), 180)}
                          placeholder="Buscar TAG..."
                          style={{ ...S.input, fontFamily: "monospace", paddingRight: 32 }}
                        />
                        {(recInput.tag || tagQuery) && (
                          <button type="button"
                            onClick={() => { setRecInput(r => ({ ...r, tag: "" })); setTagQuery(""); setTagDropdownOpen(false); }}
                            style={{ position: "absolute", right: 8, background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>
                            ✕
                          </button>
                        )}
                      </div>
                      {/* Dropdown filtrado */}
                      {tagDropdownOpen && (
                        <div style={{
                          position: "absolute", zIndex: 200, left: 0, right: 0, top: "100%",
                          background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
                          boxShadow: "0 4px 20px rgba(15,40,71,0.12)", maxHeight: 220, overflowY: "auto" as const,
                        }}>
                          {todosLosTags
                            .filter(t => t.includes(tagQuery))
                            .slice(0, 40)
                            .map(t => (
                              <button key={t} type="button"
                                onMouseDown={() => { setRecInput(r => ({ ...r, tag: t })); setTagQuery(""); setTagDropdownOpen(false); }}
                                style={{
                                  display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
                                  fontFamily: "monospace", fontSize: 13, border: "none", background: "transparent",
                                  cursor: "pointer", color: "#1e293b", borderBottom: "1px solid #f8fafc",
                                }}>
                                {t}
                              </button>
                            ))
                          }
                          {todosLosTags.filter(t => t.includes(tagQuery)).length === 0 && (
                            <p style={{ padding: "10px 14px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Sin resultados</p>
                          )}
                        </div>
                      )}
                      {/* TAG seleccionado */}
                      {recInput.tag && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "#1d4ed8", fontFamily: "monospace", fontWeight: 700 }}>
                          ✓ {recInput.tag}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Fila 2: Descripción + Agregar */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "flex-end" }}>
                    <div>
                      <label style={S.label}>Descripción</label>
                      <input value={recInput.descripcion} onChange={(e) => setRecInput((r) => ({ ...r, descripcion: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecomendacion(); } }} placeholder="Describir la recomendación…" style={S.input} />
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={addRecomendacion}
                        style={{ ...S.btnOutline, height: 39, whiteSpace: "nowrap" as const, ...(recEditIdx !== null ? { background: "#2563eb", color: "white", borderColor: "#2563eb" } : {}) }}>
                        {recEditIdx !== null ? "💾 Guardar" : "+ Agregar"}
                      </button>
                      {recEditIdx !== null && (
                        <button type="button" onClick={cancelarEdicion}
                          style={{ height: 39, padding: "0 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", color: "#64748b", cursor: "pointer", fontSize: 13 }}>
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {form.recomendaciones.length === 0 ? (
                  <p style={{ color: "#94a3b8", fontSize: 13, fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
                    Sin recomendaciones aún. Puede continuar sin agregarlas.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {form.recomendaciones.map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, background: recEditIdx === i ? "#eff6ff" : PRIOR_COLOR[r.prioridad] + "0a", border: `1px solid ${recEditIdx === i ? "#93c5fd" : PRIOR_COLOR[r.prioridad] + "25"}` }}>
                        <span style={{ ...S.badge(PRIOR_COLOR[r.prioridad]), flexShrink: 0 }}>{PRIOR_ICON[r.prioridad]} {r.prioridad}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2, flexWrap: "wrap" as const }}>
                            {r.area && (
                              <span style={{ fontSize: 11, fontWeight: 700, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 6px" }}>{r.area}</span>
                            )}
                            {r.tag && (
                              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: "#1d4ed8" }}>{r.tag}</span>
                            )}
                          </div>
                          <p style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.4 }}>{r.descripcion}</p>
                        </div>
                        <button type="button" onClick={() => editarRecomendacion(i)}
                          title="Editar"
                          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14, padding: "0 2px", flexShrink: 0 }}>✏</button>
                        <button type="button" onClick={() => { removeRec(i); if (recEditIdx === i) cancelarEdicion(); }}
                          title="Eliminar"
                          style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button onClick={() => setStep(2)} style={S.btnGhost}>← Volver</button>
                <button onClick={() => setStep(4)} style={S.btnPrimary}>Revisar →</button>
              </div>
            </>
          )}

          {/* ── Step 4: Revisión ── */}
          {step === 4 && (() => {
            const tot  = otsSeleccionadas.length;
            const conc = otsSeleccionadas.filter((o) => o.estado === "concluido" || o.estado === "revisado").length;
            const pend = otsSeleccionadas.filter((o) => o.estado === "pendiente_revision").length;
            const inc  = tot - conc - pend;
            const hhT  = otsSeleccionadas.reduce((s, o) => s + o.lineas.reduce((a, l) => a + (l.tiempoRealHrs ?? 0), 0), 0);
            return (
              <>
                {/* Encabezado */}
                <div style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Encabezado</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
                    <div><span style={S.label}>Fecha</span><p style={{ fontSize: 14, color: "#1e293b" }}>{form.fecha}</p></div>
                    <div><span style={S.label}>Turno</span><p style={{ fontSize: 14, color: "#1e293b" }}>{form.turno}</p></div>
                    <div style={{ gridColumn: "1/-1" }}><span style={S.label}>Supervisor</span><p style={{ fontSize: 14, color: "#1e293b" }}>{form.supervisorNombre}</p></div>
                  </div>
                </div>

                {/* Métricas */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
                  <div style={S.metricCard("#2563eb")}><p style={{ fontSize: 20, fontWeight: 800, color: "#2563eb" }}>{tot}</p><p style={{ fontSize: 11, color: "#64748b" }}>OTs</p></div>
                  <div style={S.metricCard("#16a34a")}><p style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>{conc}</p><p style={{ fontSize: 11, color: "#64748b" }}>Concluidas</p></div>
                  <div style={S.metricCard("#d97706")}><p style={{ fontSize: 20, fontWeight: 800, color: "#d97706" }}>{pend}</p><p style={{ fontSize: 11, color: "#64748b" }}>Pendientes</p></div>
                  <div style={S.metricCard("#7c3aed")}><p style={{ fontSize: 20, fontWeight: 800, color: "#7c3aed" }}>{Math.round(hhT * 10) / 10}h</p><p style={{ fontSize: 11, color: "#64748b" }}>HH</p></div>
                </div>

                {inc > 0 && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
                    <p style={{ color: "#dc2626", fontSize: 12, fontWeight: 600 }}>⚠ {inc} OT(s) inconclusa(s) o en corrección</p>
                  </div>
                )}

                {/* Lista OTs incluidas */}
                <div style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 10 }}>OTs incluidas en el reporte ({otsSeleccionadas.length})</div>
                  {otsSeleccionadas.map((ot) => {
                    const crit = form.otsCriticas.includes(ot._id);
                    const pendOT = form.otsPendientesSiguienteTurno.includes(ot._id);
                    const nota = form.notasOTs[ot._id];
                    return (
                      <div key={ot._id} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 13, minWidth: 70 }}>{ot.otJdeNumero ?? ot.numeroOT}</span>
                          <span style={S.badge("#475569")}>{ot.areaCodigo}</span>
                          <span style={S.badge(ESTADO_COLOR[ot.estado] ?? "#64748b")}>{ESTADO_LABEL[ot.estado] ?? ot.estado}</span>
                          {crit && <span style={S.badge("#dc2626")}>⚠ Crítica</span>}
                          {pendOT && <span style={S.badge("#d97706")}>→ Sig. turno</span>}
                        </div>
                        <p style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{ot.lineas.map((l) => l.tag).join(", ")} · {ot.tecnicos.map((t) => t.nombreCompleto).join(", ")}</p>
                        {nota && <p style={{ fontSize: 12, color: "#1e293b", marginTop: 4, fontStyle: "italic", paddingLeft: 8, borderLeft: "3px solid #e2e8f0" }}>{nota}</p>}
                      </div>
                    );
                  })}
                </div>

                {/* Recomendaciones */}
                {form.recomendaciones.length > 0 && (
                  <div style={S.card}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 10 }}>Recomendaciones ({form.recomendaciones.length})</div>
                    {form.recomendaciones.map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, padding: "8px 10px", borderRadius: 8, background: PRIOR_COLOR[r.prioridad] + "08", border: `1px solid ${PRIOR_COLOR[r.prioridad]}20` }}>
                        <span style={{ ...S.badge(PRIOR_COLOR[r.prioridad]), flexShrink: 0 }}>{PRIOR_ICON[r.prioridad]} {r.prioridad}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: r.area || r.tag ? 4 : 0 }}>
                            {r.area && (
                              <span style={{ fontSize: 11, fontWeight: 700, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 7px" }}>
                                {r.area}
                              </span>
                            )}
                            {r.tag && (
                              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, padding: "1px 7px" }}>
                                {r.tag}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 13, color: "#1e293b" }}>{r.descripcion}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {submitErr && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                    <p style={{ color: "#dc2626", fontSize: 13 }}>{submitErr}</p>
                  </div>
                )}

                <div style={{ ...S.card, background: "#f8fafc" }}>
                  <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginBottom: 14 }}>
                    <strong>Borrador</strong>: guarda sin enviar, puede completarse después.<br />
                    <strong>Enviar turno</strong>: cierra el reporte y lo deja disponible para la reunión de coordinación.
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={() => setStep(3)} style={S.btnGhost} disabled={submitting}>← Editar</button>
                    <button onClick={() => submit("borrador")} style={{ ...S.btnGhost, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
                      {submitting ? "Guardando…" : "💾 Guardar borrador"}
                    </button>
                    <button onClick={() => submit("enviado")} style={{ ...S.btnGreen, marginLeft: "auto", opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
                      {submitting ? "Enviando…" : "Enviar turno ✓"}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // ─── VISTA DETALLE ────────────────────────────────────────────────────────────

  if (view === "detalle" && detalle) {
    const r = detalle;
    const enviado = r.estado === "enviado";
    const notasMap: Record<string, string> = {};
    for (const n of (r.notasOTs ?? [])) notasMap[n.otId] = n.nota;

    return (
      <div style={S.page}>
        <AppHeader backHref="/ordenes" />
        <div style={S.wrap}>
          {/* Cabecera */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={() => setView("lista")} style={{ ...S.btnGhost, padding: "7px 14px" }}>← Lista</button>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847" }}>
                  Reporte {new Date(r.fecha).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
                </h1>
                <span style={S.badge(enviado ? "#16a34a" : "#64748b")}>{enviado ? "Enviado" : "Borrador"}</span>
                <span style={S.badge(r.turno === "Nocturno" ? "#7c3aed" : "#0891b2")}>{r.turno}</span>
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Supervisor: {r.supervisorNombre} · Todas las áreas</p>
            </div>
            <a
              href={`/ordenes/turno/${r._id}/imprimir`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...S.btnPrimary, textDecoration: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              🖨 Ver / Descargar PDF
            </a>
          </div>

          {/* Métricas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
            <div style={S.metricCard("#2563eb")}><p style={{ fontSize: 24, fontWeight: 800, color: "#2563eb" }}>{r.resumenEjecutivo.totalOTs}</p><p style={{ fontSize: 11, color: "#64748b" }}>Total OTs</p></div>
            <div style={S.metricCard("#16a34a")}><p style={{ fontSize: 24, fontWeight: 800, color: "#16a34a" }}>{r.resumenEjecutivo.concluidas}</p><p style={{ fontSize: 11, color: "#64748b" }}>Concluidas</p></div>
            <div style={S.metricCard("#d97706")}><p style={{ fontSize: 24, fontWeight: 800, color: "#d97706" }}>{r.resumenEjecutivo.pendientes}</p><p style={{ fontSize: 11, color: "#64748b" }}>Pendientes</p></div>
            <div style={S.metricCard("#7c3aed")}><p style={{ fontSize: 24, fontWeight: 800, color: "#7c3aed" }}>{r.resumenEjecutivo.hhTotales}h</p><p style={{ fontSize: 11, color: "#64748b" }}>HH Totales</p></div>
          </div>

          {/* HH detalle */}
          <div style={{ ...S.card, padding: "12px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div><span style={S.label}>HH Correctivo</span><p style={{ fontSize: 16, fontWeight: 700, color: "#dc2626" }}>{r.resumenEjecutivo.hhCorrectivo}h</p></div>
              <div><span style={S.label}>HH Preventivo</span><p style={{ fontSize: 16, fontWeight: 700, color: "#2563eb" }}>{r.resumenEjecutivo.hhPreventivo}h</p></div>
              {r.resumenEjecutivo.inconclusas > 0 && (
                <div><span style={S.label}>Inconclusas</span><p style={{ fontSize: 16, fontWeight: 700, color: "#dc2626" }}>{r.resumenEjecutivo.inconclusas}</p></div>
              )}
              {r.otsCriticas.length > 0 && (
                <div><span style={S.label}>Críticas</span><p style={{ fontSize: 16, fontWeight: 700, color: "#dc2626" }}>⚠ {r.otsCriticas.length}</p></div>
              )}
              {r.otsPendientesSiguienteTurno.length > 0 && (
                <div><span style={S.label}>Sig. turno</span><p style={{ fontSize: 16, fontWeight: 700, color: "#d97706" }}>→ {r.otsPendientesSiguienteTurno.length}</p></div>
              )}
            </div>
          </div>

          {/* OTs incluidas */}
          {r.otIds.length > 0 && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>OTs del turno ({r.otIds.length})</div>
              {detalleOTs.length > 0 ? (
                detalleOTs.map((ot) => {
                  const crit = r.otsCriticas.includes(ot._id);
                  const pend = r.otsPendientesSiguienteTurno.includes(ot._id);
                  const nota = notasMap[ot._id];
                  const estadoColor = ESTADO_COLOR[ot.estado] ?? "#64748b";
                  return (
                    <div key={ot._id} style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>{ot.otJdeNumero ?? ot.numeroOT}</span>
                        <span style={S.badge("#475569")}>{ot.areaCodigo}</span>
                        <span style={S.badge(estadoColor)}>{ESTADO_LABEL[ot.estado] ?? ot.estado}</span>
                        {ot.lineas.map((l, i) => <span key={i} style={S.badge(tipoColor(l.tipoOT))}>{tipoOtDisplay(l.tipoOT).texto}</span>)}
                        {crit && <span style={S.badge("#dc2626")}>⚠ Crítica</span>}
                        {pend && <span style={S.badge("#d97706")}>→ Sig. turno</span>}
                      </div>
                      <p style={{ fontSize: 12, color: "#64748b" }}>
                        {ot.lineas.map((l) => l.tag).join(", ")} · {ot.tecnicos.map((t) => t.nombreCompleto).join(", ")}
                      </p>
                      {ot.lineas[0]?.sintoma && (
                        <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 2 }}>
                          {ot.lineas[0].sintoma}
                        </p>
                      )}
                      {ot.lineas[0]?.resolucionAplicada && (
                        <p style={{ fontSize: 12, color: "#16a34a", marginTop: 2 }}>
                          ✓ {ot.lineas[0].resolucionAplicada}
                        </p>
                      )}
                      {nota && (
                        <div style={{ marginTop: 6, padding: "6px 10px", background: "#fef9c3", borderRadius: 6, borderLeft: "3px solid #fbbf24" }}>
                          <p style={{ fontSize: 12, color: "#78350f", fontWeight: 600 }}>Nota supervisor:</p>
                          <p style={{ fontSize: 12, color: "#1e293b" }}>{nota}</p>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                // Fallback: mostrar solo IDs si no cargaron los datos
                r.otIds.map((id) => {
                  const crit = r.otsCriticas.includes(id);
                  const pend = r.otsPendientesSiguienteTurno.includes(id);
                  const nota = notasMap[id];
                  return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: "#64748b" }}>{id.slice(-6)}</span>
                      {crit && <span style={S.badge("#dc2626")}>⚠ Crítica</span>}
                      {pend && <span style={S.badge("#d97706")}>→ Sig. turno</span>}
                      {nota && <span style={{ fontSize: 11, color: "#78350f", fontStyle: "italic" }}>{nota}</span>}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Recomendaciones */}
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>Recomendaciones para siguiente turno</div>
              {!editandoRecs ? (
                <button onClick={() => { setRecsEditables([...r.recomendaciones]); setEditandoRecs(true); setTagQueryDetalle({}); }}
                  style={{ fontSize: 12, color: "#2563eb", background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                  ✏ Editar
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => guardarRecsEditadas(r._id)}
                    style={{ fontSize: 12, fontWeight: 700, color: "white", background: "#16a34a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
                    💾 Guardar
                  </button>
                  <button onClick={() => setEditandoRecs(false)}
                    style={{ fontSize: 12, color: "#64748b", background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>

            {r.recomendaciones.length === 0 && !editandoRecs && (
              <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Sin recomendaciones.</p>
            )}

            {/* Vista normal */}
            {!editandoRecs && (["URGENTE", "PLANIFICAR", "SEGURIDAD", "SEGUIMIENTO"] as Prioridad[]).map((p) => {
              const items = r.recomendaciones.filter((x) => x.prioridad === p);
              if (items.length === 0) return null;
              return (
                <div key={p} style={{ marginBottom: 12 }}>
                  <span style={{ ...S.badge(PRIOR_COLOR[p]), marginBottom: 8, display: "inline-block" }}>{PRIOR_ICON[p]} {p}</span>
                  {items.map((item, i) => (
                    <div key={i} style={{ paddingLeft: 12, marginBottom: 6, display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "#94a3b8", marginTop: 1 }}>•</span>
                      <div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 2 }}>
                          {item.area && <span style={{ fontSize: 10, fontWeight: 700, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 6px" }}>{item.area}</span>}
                          {item.tag && <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "#1d4ed8" }}>{item.tag}</span>}
                        </div>
                        <p style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5 }}>{item.descripcion}</p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Modo edición */}
            {editandoRecs && recsEditables.map((rec, i) => (
              <div key={i} style={{ marginBottom: 8, border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", background: "#fafafa" }}>
                <div style={{ display: "grid", gridTemplateColumns: "130px 140px 1fr auto", gap: 6, alignItems: "center" }}>
                  <select value={rec.prioridad} onChange={e => setRecsEditables(prev => prev.map((x, j) => j === i ? { ...x, prioridad: e.target.value as Prioridad } : x))}
                    style={{ ...S.select, fontSize: 12 }}>
                    {(["URGENTE","PLANIFICAR","SEGUIMIENTO","SEGURIDAD"] as Prioridad[]).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={rec.area ?? ""} onChange={e => setRecsEditables(prev => prev.map((x, j) => j === i ? { ...x, area: e.target.value || undefined } : x))}
                    style={{ ...S.select, fontSize: 12 }}>
                    <option value="">— Área —</option>
                    {["Chancado","Molienda","Flotación","Filtros","Eléctrico","Instrumentación","Mantenimiento General","Bodega / Almacén","Operaciones"].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <div style={{ position: "relative" }}>
                    <input
                      value={rec.tag ?? tagQueryDetalle[i] ?? ""}
                      onChange={e => {
                        const v = e.target.value.toUpperCase();
                        setTagQueryDetalle(prev => ({ ...prev, [i]: v }));
                        setRecsEditables(prev => prev.map((x, j) => j === i ? { ...x, tag: v || undefined } : x));
                        setTagDropDetalle(v.length >= 2 ? i : null);
                      }}
                      onBlur={() => setTimeout(() => setTagDropDetalle(null), 180)}
                      placeholder="TAG..."
                      style={{ ...S.input, fontFamily: "monospace", fontSize: 12 }}
                    />
                    {tagDropDetalle === i && (
                      <div style={{ position: "absolute", zIndex: 300, left: 0, right: 0, top: "100%", background: "white", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", maxHeight: 180, overflowY: "auto" as const }}>
                        {todosLosTags.filter(t => t.includes(tagQueryDetalle[i] ?? "")).slice(0, 30).map(t => (
                          <button key={t} type="button"
                            onMouseDown={() => { setRecsEditables(prev => prev.map((x, j) => j === i ? { ...x, tag: t } : x)); setTagDropDetalle(null); }}
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", fontFamily: "monospace", fontSize: 12, border: "none", background: "transparent", cursor: "pointer", borderBottom: "1px solid #f8fafc" }}>
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setRecsEditables(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16 }}>✕</button>
                </div>
                <input value={rec.descripcion} onChange={e => setRecsEditables(prev => prev.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                  style={{ ...S.input, marginTop: 6, fontSize: 13 }} />
              </div>
            ))}
          </div>

          {/* Acción enviar */}
          {!enviado && (
            <div style={{ ...S.card, background: "#f8fafc" }}>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Este reporte está guardado como borrador. Envíelo para la reunión de coordinación de las 7:00 AM.</p>
              <button onClick={() => enviarReporte(r._id)} style={S.btnGreen}>Enviar turno ✓</button>
            </div>
          )}

          {enviado && (
            <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <p style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ Reporte enviado — listo para reunión de coordinación.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
