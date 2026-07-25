"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { getFechaTurno } from "@/lib/turno";
import { tipoOtDisplay } from "@/lib/tiposOt";

// ─── Types ───────────────────────────────────────────────────────────────────

type TurnoTipo = "Diurno" | "Nocturno";
type Novedad = { prioridad: "URGENTE" | "ATENCION" | "INFORMACION"; tag?: string; descripcion: string };

type ReporteDoc = {
  _id: string; tipo: string; turno: string; fecha: string;
  supervisorId: string; supervisorNombre: string;
  otIds: string[]; otsCriticas: string[]; otsPendientesSiguienteTurno: string[];
  notasOTs: { otId: string; nota: string }[];
  recomendaciones: Novedad[];
  resumenEjecutivo: { totalOTs: number; concluidas: number; pendientes: number; inconclusas: number; hhTotales: number; hhCorrectivo: number; hhPreventivo: number };
  estado: string;
};

// OT registrada (desde /api/ordenes)
type OTRegistrada = {
  _id: string; numeroOT: string; fecha: string; turno: string; areaCodigo: string;
  estado: string; otJdeNumero?: string | null;
  tecnicos: { nombreCompleto: string }[];
  lineas: { tag: string; tipoOT: string; tiempoRealHrs?: number; descripcionEquipo?: string; sintoma?: string; resolucionAplicada?: string; descripcionTrabajo?: string }[];
};

// OT del plan semanal (desde /api/programacion-semanal)
type BitacoraEntry = { turno: string; supervisor: string; nota: string; hhAtendidas: number; fecha?: string };

type OTPlan = {
  id: string;           // "plan-{progId}-{otId}"
  numeroOT: string; tipoOT: string; descripcion: string;
  tag: string; descripcionEquipo?: string; hhTotal: number;
  personalAsignado: string[]; grupo: string; dia: string;
  estado: string; esGuardia: boolean;
  bitacora?: BitacoraEntry[];
  hijasReales?: OTRegistrada[];
  ordenTrabajoId?: string; ordenTrabajoNum?: string;
  areaCodigo: string; disciplina: string;
};

type AreaOpt = { codigo: string; nombre: string; superintendencia?: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DIA_MAP = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"] as const;
// El grupo "Diurno" y "Nocturno" son específicamente los turneros
// G1-G4 son técnicos de mantenimiento regular (no turneros)
const GRUPO_DIURNO   = "Diurno";
const GRUPO_NOCTURNO = "Nocturno";

function getWeekYear(fechaStr: string) {
  const d = new Date(fechaStr + "T12:00:00");
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const semana = Math.ceil((((dt.getTime() - y.getTime()) / 86400000) + 1) / 7);
  return { semana, anio: dt.getUTCFullYear() };
}

function diaSemana(fechaStr: string): string {
  const d = new Date(fechaStr + "T12:00:00");
  return DIA_MAP[d.getDay()];
}

function disciplinaDeArea(areaCodigo: string): string {
  if (areaCodigo === "3320") return "INSTRUMENTACIÓN";
  if (areaCodigo === "3319" || areaCodigo === "3311") return "ELÉCTRICO";
  return "MECÁNICO";
}

// Reporte de Turno — Técnico/Turnero es exclusivo de Eléctrico e Instrumentación.
// Ninguna otra área (contratistas TESA 3348, Telecom 3351, u otras) tiene OPEPLANT
// ni debe registrar sus OTs en este reporte.
const AREAS_ELEC_INST = new Set(["3320", "3319", "3311"]);

const PRIOR_COLOR: Record<string, string> = { URGENTE: "#dc2626", ATENCION: "#d97706", INFORMACION: "#2563eb" };
const ESTADO_COLOR: Record<string, string> = { borrador: "#64748b", enviado: "#16a34a" };

const S = {
  page:  { minHeight: "100vh", background: "#f1f5f9" },
  wrap:  { maxWidth: 760, margin: "0 auto", padding: "20px 16px 56px" },
  card:  { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 12 },
  label: { display: "block" as const, fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 5 },
  input: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white" },
  textarea: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 52, background: "white" },
  badge: (color: string) => ({ display: "inline-block" as const, background: color + "18", color, border: `1px solid ${color}40`, borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }),
  btnPrimary: { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGreen:   { background: "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGhost:   { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const },
};

function Steps({ step }: { step: number }) {
  const labels = ["Encabezado", "OTs Turno", "Novedades", "Generar PDF"];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12px 0 20px" }}>
      {labels.map((l, i) => {
        const n = i + 1;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: step > n ? "#2563eb" : step === n ? "#1d4ed8" : "#e2e8f0", color: step >= n ? "white" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, boxShadow: step === n ? "0 0 0 4px #2563eb25" : "none" }}>
                {step > n ? "✓" : n}
              </div>
              <span style={{ fontSize: 10, color: step >= n ? "#2563eb" : "#94a3b8", fontWeight: 600 }}>{l}</span>
            </div>
            {i < labels.length - 1 && <div style={{ width: 44, height: 2, background: step > n ? "#2563eb" : "#e2e8f0", margin: "0 3px 14px" }} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReporteTurnoTecnicoPage() {
  const router = useRouter();
  const { user } = useUser();
  const { fecha: shiftFecha, turno: shiftTurno } = getFechaTurno();

  const [view, setView]       = useState<"lista" | "nuevo" | "detalle">("lista");
  const [step, setStep]       = useState(1);
  const [detalle, setDetalle] = useState<ReporteDoc | null>(null);

  const [reportes, setReportes]       = useState<ReporteDoc[]>([]);
  const [otsRegistradas, setOtsReg]   = useState<OTRegistrada[]>([]);
  const [otsPlan, setOtsPlan]         = useState<OTPlan[]>([]);
  const [otsContinuacion, setOtsContinuacion] = useState<OTRegistrada[]>([]);
  const [areas, setAreas]             = useState<AreaOpt[]>([]);
  const [loadingReportes, setLoadingRep] = useState(true);
  const [loadingOTs, setLoadingOTs]   = useState(false);

  const emptyForm = () => ({
    fecha: shiftFecha, turno: shiftTurno as TurnoTipo,
    areaCodigo: (user?.areas?.[0] ?? ""),
    otIds: [] as string[],
    otsPlanIds: [] as string[],
    otsCriticas: [] as string[],
    otsPendientes: [] as string[],
    notasOTs: {} as Record<string, string>,
    novedades: [] as Novedad[],
  });

  const [form, setForm] = useState(emptyForm);
  const [editandoId, setEditandoId]   = useState<string | null>(null);
  const [novInput, setNovInput] = useState<{ prioridad: "URGENTE" | "ATENCION" | "INFORMACION"; tag: string; descripcion: string }>({ prioridad: "INFORMACION", tag: "", descripcion: "" });
  const [todosLosTags, setTodosLosTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery]         = useState("");
  const [tagDropdown, setTagDropdown]   = useState(false);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [submitErr, setSubmitErr]     = useState("");
  const [cerrandoOpeplant, setCerrandoOpeplant] = useState<Set<string>>(new Set());
  const [opeplantCerrada, setOpeplantCerrada]   = useState<Set<string>>(new Set());

  // Área efectiva para cargar OTs
  const areaEfectiva = form.areaCodigo || (user?.areas?.[0] ?? "");
  const disciplina = areaEfectiva ? disciplinaDeArea(areaEfectiva) : "";
  // Este reporte es exclusivo de Eléctrico/Instrumentación — cualquier otra área
  // (asignada o elegida) queda bloqueada, aunque areaEfectiva no esté vacía.
  const areaValida = areaEfectiva !== "" && AREAS_ELEC_INST.has(areaEfectiva);

  // ─── Load áreas (para selector admin/sup) ───────────────────────────────────

  useEffect(() => {
    fetch("/api/areas").then(r => r.json()).then(setAreas).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/plan-turno/tags")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTodosLosTags(data); })
      .catch(() => {});
  }, []);

  // Preseleccionar área si el usuario tiene solo una
  useEffect(() => {
    if (user?.areas?.length === 1 && !form.areaCodigo) {
      setForm(f => ({ ...f, areaCodigo: user.areas[0] }));
    }
  }, [user, form.areaCodigo]);

  // ─── Load reportes ──────────────────────────────────────────────────────────

  const loadReportes = useCallback(async () => {
    setLoadingRep(true);
    const params = new URLSearchParams({ tipo: "tecnico", limit: "60" });
    if (user?.rol === 4) params.set("supervisorId", user.id);
    const data = await fetch(`/api/reportes-turno?${params}`).then(r => r.json()).catch(() => []);
    setReportes(Array.isArray(data) ? data : []);
    setLoadingRep(false);
  }, [user]);

  useEffect(() => { if (user) loadReportes(); }, [user, loadReportes]);

  // ─── Load OTs del turno (registradas + plan) ────────────────────────────────

  const loadOTs = useCallback(async () => {
    if (!form.fecha || !user) return;
    setOtsReg([]);
    setOtsPlan([]);
    setOtsContinuacion([]);

    // Este reporte es exclusivo de Eléctrico/Instrumentación (únicas áreas con
    // OPEPLANT). Sin área resuelta o con un área distinta (p.ej. contratistas
    // TESA 3348 / Telecom 3351) no se carga nada.
    if (!areaValida) { setLoadingOTs(false); return; }

    setLoadingOTs(true);
    const area = areaEfectiva;
    const { semana, anio } = getWeekYear(form.fecha);
    const diaOT = diaSemana(form.fecha);
    const grupoTurno = form.turno === "Nocturno" ? GRUPO_NOCTURNO : GRUPO_DIURNO;

    // ── 1. OTs registradas — CMR y CMP del turno activo (incluye OTs vinculadas a OPEPLANT)
    const paramsOrd = new URLSearchParams({ fecha: form.fecha, turno: form.turno, limit: "100", incluirHijas: "true" });
    if (area) paramsOrd.set("area", area);
    const dataOrd: OTRegistrada[] = await fetch(`/api/ordenes?${paramsOrd}`).then(r => r.json()).catch(() => []);
    // Solo correctivos (CMR/CMP); los preventivos son de equipos de mantenimiento regular (G1-G4)
    const soloCorrectivos = (Array.isArray(dataOrd) ? dataOrd : []).filter(o =>
      o.lineas.some(l => l.tipoOT === "CMR" || l.tipoOT === "CMP")
    );

    // Mapa de OTs hijas reales por N° OT JDE, sin filtrar por técnico — la
    // guardia OPEPLANT es compartida entre turneros, así que la tarjeta de
    // Bitácora debe mostrar lo registrado aunque lo haya cargado otro técnico.
    const hijasPorNumeroOT = new Map<string, OTRegistrada[]>();
    for (const o of soloCorrectivos) {
      if (!o.otJdeNumero) continue;
      const arr = hijasPorNumeroOT.get(o.otJdeNumero) ?? [];
      arr.push(o);
      hijasPorNumeroOT.set(o.otJdeNumero, arr);
    }

    // Filtrar además por nombre del técnico si es rol=4
    const registradas = user.rol === 4
      ? soloCorrectivos.filter(o =>
          o.tecnicos.some(t => t.nombreCompleto.toLowerCase().includes(user.nombre.toLowerCase()))
        )
      : soloCorrectivos;
    setOtsReg(registradas);

    // ── 2. OTs del plan semanal (incluyendo bitácora OPEPLANT) ──────────────
    // Filtrar en el servidor: solo OTs del día y del área
    // El API acepta "dia" para filtrar otsProgramadas server-side
    const paramsPlan = new URLSearchParams({ semana: String(semana), anio: String(anio), limit: "20", dia: diaOT });
    if (area) paramsPlan.set("areaCodigo", area);
    const dataPlanes = await fetch(`/api/programacion-semanal?${paramsPlan}`).then(r => r.json()).catch(() => []);

    const planes: OTPlan[] = [];
    for (const prog of (Array.isArray(dataPlanes) ? dataPlanes : [])) {
      const disc = prog.disciplina ?? "";
      for (const ot of (prog.otsProgramadas ?? [])) {
        // Exclusivo del grupo turnero (Diurno/Nocturno) — G1-G4 son mantenimiento
        // regular (no turneros) y no deben entrar en este reporte.
        if (ot.grupo !== grupoTurno) continue;
        planes.push({
          id: `plan-${prog._id}-${ot.id ?? ot.numeroOT}`,
          numeroOT: ot.numeroOT,
          tipoOT: ot.tipoOT ?? "",
          descripcion: ot.descripcion ?? "",
          tag: ot.tag ?? "",
          descripcionEquipo: ot.descripcionEquipo,
          hhTotal: ot.hhTotal ?? 0,
          personalAsignado: ot.personalAsignado ?? [],
          grupo: ot.grupo,
          dia: ot.dia,
          estado: ot.estado ?? "no_iniciada",
          // El flag esGuardia casi nunca queda seteado en BD; el tag "OPEPLANT" es
          // la señal confiable (mismo criterio que registro/turnero/semanales).
          esGuardia: !!ot.esGuardia || String(ot.tag ?? "").includes("OPEPLANT"),
          bitacora: Array.isArray(ot.bitacora) ? ot.bitacora : [],
          hijasReales: hijasPorNumeroOT.get(ot.numeroOT) ?? [],
          ordenTrabajoId: ot.ordenTrabajoId,
          ordenTrabajoNum: ot.ordenTrabajoNum,
          areaCodigo: prog.areaCodigo ?? area,
          disciplina: disc,
        });
      }
    }
    setOtsPlan(planes);

    // ── 3. OTs en_proceso del técnico de días anteriores (continuación) ────
    // Solo OTs de la semana actual (desde el lunes), no de semanas anteriores
    const lunesFecha = new Date(form.fecha + "T12:00:00");
    const diaSem = lunesFecha.getDay() || 7; // 1=Lu ... 7=Do
    lunesFecha.setDate(lunesFecha.getDate() - (diaSem - 1));
    const lunesStr = lunesFecha.toISOString().split("T")[0];

    const paramsCont = new URLSearchParams({ estado: "en_proceso", limit: "50", fechaDesde: lunesStr });
    if (area) paramsCont.set("area", area);
    const dataCont: OTRegistrada[] = await fetch(`/api/ordenes?${paramsCont}`).then(r => r.json()).catch(() => []);
    const hoy = form.fecha;
    const continuacion = (Array.isArray(dataCont) ? dataCont : []).filter(o => {
      // Solo OTs de días anteriores esta semana (no de hoy)
      if (o.fecha.slice(0, 10) >= hoy) return false;
      // Solo OTs del plan (tienen otJdeNumero)
      if (!o.otJdeNumero) return false;
      // Si es técnico (rol=4), solo sus OTs
      if (user?.rol === 4) {
        return o.tecnicos.some(t =>
          t.nombreCompleto.toLowerCase().includes(user.nombre.toLowerCase())
        );
      }
      return true;
    });
    setOtsContinuacion(continuacion);

    setLoadingOTs(false);
  }, [form.fecha, form.turno, areaEfectiva, user]);

  useEffect(() => {
    if (view === "nuevo" && step === 2) loadOTs();
  }, [view, step, loadOTs]);

  function patchForm(p: Partial<typeof form>) { setForm(f => ({ ...f, ...p })); }

  function toggleOT(id: string, isPlan: boolean) {
    if (isPlan) {
      patchForm({ otsPlanIds: form.otsPlanIds.includes(id) ? form.otsPlanIds.filter(x => x !== id) : [...form.otsPlanIds, id] });
    } else {
      patchForm({ otIds: form.otIds.includes(id) ? form.otIds.filter(x => x !== id) : [...form.otIds, id] });
    }
  }
  function toggleCritica(id: string) {
    patchForm({ otsCriticas: form.otsCriticas.includes(id) ? form.otsCriticas.filter(x => x !== id) : [...form.otsCriticas, id] });
  }
  function togglePendiente(id: string) {
    patchForm({ otsPendientes: form.otsPendientes.includes(id) ? form.otsPendientes.filter(x => x !== id) : [...form.otsPendientes, id] });
  }

  function agregarNovedad() {
    if (!novInput.descripcion.trim()) return;
    patchForm({ novedades: [...form.novedades, { ...novInput }] });
    setNovInput({ prioridad: "INFORMACION", tag: "", descripcion: "" });
  }

  // ─── Edición de reporte existente (solo admin) ─────────────────────────────

  type ReporteConPlan = ReporteDoc & { otsPlanData?: { otId: string }[] };

  function cargarParaEditar(r: ReporteDoc) {
    const rep = r as ReporteConPlan;
    setEditandoId(r._id);
    setForm({
      fecha: r.fecha.slice(0, 10),
      turno: r.turno as TurnoTipo,
      areaCodigo: user?.areas?.[0] ?? "",
      otIds: r.otIds,
      otsPlanIds: rep.otsPlanData?.map(o => o.otId) ?? [],
      otsCriticas: r.otsCriticas,
      otsPendientes: r.otsPendientesSiguienteTurno,
      notasOTs: Object.fromEntries(r.notasOTs.map(n => [n.otId, n.nota])),
      novedades: r.recomendaciones,
    });
    setStep(2);
    setView("nuevo");
  }

  // ─── Submit ─────────────────────────────────────────────────────────────────

  async function submit() {
    if (!user) return;
    setSubmitting(true); setSubmitErr("");
    try {
      const notasArr = Object.entries(form.notasOTs).filter(([, v]) => v.trim()).map(([otId, nota]) => ({ otId, nota }));
      const planSeleccionadas = otsPlan.filter(o => form.otsPlanIds.includes(o.id));
      const planData = planSeleccionadas.map(o => ({
        otId: o.id,
        ordenTrabajoId: o.ordenTrabajoId ?? null,
        numeroOT: o.numeroOT,
        tag: o.tag,
        disciplina: o.disciplina,
        tipoOT: o.tipoOT,
        descripcion: o.descripcion,
        tecnicos: o.personalAsignado,
        hhTotal: o.hhTotal,
        estado: o.estado,
        esGuardia: o.esGuardia,
        bitacora: o.bitacora ?? [],
      }));

      if (editandoId) {
        const res = await fetch(`/api/reportes-turno/${editandoId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turno: form.turno,
            fecha: form.fecha,
            otIds: form.otIds,
            otsCriticas: [...form.otsCriticas],
            otsPendientesSiguienteTurno: form.otsPendientes,
            notasOTs: notasArr,
            recomendaciones: form.novedades,
            otsPlanData: planData,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al guardar");
        setEditandoId(null);
        setView("lista");
        loadReportes();
      } else {
        const payload = {
          tipo: "tecnico",
          estado: "enviado",
          turno: form.turno,
          fecha: form.fecha,
          supervisorId: user.id,
          supervisorNombre: `${user.nombre}${disciplina ? " — " + disciplina : ""}`,
          otIds: form.otIds,
          otsCriticas: [...form.otsCriticas],
          otsPendientesSiguienteTurno: form.otsPendientes,
          notasOTs: notasArr,
          recomendaciones: form.novedades,
          otsPlanData: planData,
        };
        const res = await fetch("/api/reportes-turno", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al guardar");
        const url = `/ordenes/turno-tecnico/${data.reporte._id}/imprimir`;
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setView("lista");
      }
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Cerrar OT OPEPLANT consolidada ─────────────────────────────────────────

  async function cerrarOpeplant(ordenTrabajoId: string) {
    setCerrandoOpeplant(prev => new Set([...prev, ordenTrabajoId]));
    try {
      const res = await fetch(`/api/ordenes/${ordenTrabajoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "pendiente_revision",
          cambio: "OT OPEPLANT enviada a revisión — cierre semanal",
          usuarioId: user?.id,
          nombreUsuario: user?.nombre,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error ?? "Error al cerrar OT OPEPLANT");
        return;
      }
      setOpeplantCerrada(prev => new Set([...prev, ordenTrabajoId]));
    } catch {
      alert("Error de conexión al cerrar OT OPEPLANT");
    } finally {
      setCerrandoOpeplant(prev => { const s = new Set(prev); s.delete(ordenTrabajoId); return s; });
    }
  }

  // ─── Filtro búsqueda ────────────────────────────────────────────────────────

  function matchFilter(texto: string, campos: (string | undefined)[]) {
    if (!texto) return true;
    const q = texto.toLowerCase();
    return campos.some(c => (c ?? "").toLowerCase().includes(q));
  }

  const otsRegFiltradas = otsRegistradas.filter(o =>
    matchFilter(filtroTexto, [o.numeroOT, o.otJdeNumero ?? "", ...o.lineas.map(l => l.tag + " " + (l.descripcionEquipo ?? ""))])
  );
  const otsPlanFiltradas = otsPlan.filter(o =>
    matchFilter(filtroTexto, [o.numeroOT, o.tag, o.descripcion])
  );
  const bitacora = otsPlanFiltradas.filter(o => o.esGuardia);
  const planNormal = otsPlanFiltradas.filter(o => !o.esGuardia);

  const otsContinuacionFiltradas = otsContinuacion.filter(o =>
    matchFilter(filtroTexto, [o.numeroOT, o.otJdeNumero ?? "", ...o.lineas.map(l => l.tag + " " + (l.descripcionEquipo ?? ""))])
  );
  const totalSeleccionadas = form.otIds.length + form.otsPlanIds.length;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <AppHeader backHref="/ordenes" />
      <div style={S.wrap}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 2 }}>Reporte de Turno — Técnico</h1>
          <p style={{ fontSize: 12, color: "#64748b" }}>Registro del turno por el técnico / supervisor de guardia</p>
        </div>

        {/* ══ VISTA LISTA ══════════════════════════════════════════════════════ */}
        {view === "lista" && (
          <>
            <button onClick={() => { setEditandoId(null); setView("nuevo"); setStep(1); setForm(emptyForm()); }}
              style={{ ...S.btnPrimary, marginBottom: 16, display: "block" }}>
              + Nuevo reporte de turno
            </button>

            {loadingReportes ? (
              <div style={{ textAlign: "center", padding: 32, color: "#94a3b8" }}>Cargando reportes…</div>
            ) : reportes.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", color: "#94a3b8", padding: 32 }}>Sin reportes de turno registrados.</div>
            ) : (
              reportes.map(r => {
                const fecha = new Date(r.fecha).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
                return (
                  <div key={r._id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={S.badge(r.turno === "Diurno" ? "#d97706" : "#7c3aed")}>{r.turno}</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#0f2847" }}>{fecha}</span>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{r.supervisorNombre}</span>
                        <span style={S.badge(ESTADO_COLOR[r.estado] ?? "#64748b")}>{r.estado}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        {r.otIds.length} OTs registradas · {(r as unknown as { otsPlanData?: unknown[] }).otsPlanData?.length ?? 0} del plan · {r.recomendaciones.length} novedades
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button onClick={() => setDetalle(r)} style={S.btnGhost}>Ver</button>
                      <button onClick={() => window.open(`/ordenes/turno-tecnico/${r._id}/imprimir`, "_blank")}
                        style={{ ...S.btnGreen, padding: "8px 14px", fontSize: 13 }}>🖨 PDF</button>
                      {user && user.rol <= 4 && (
                        <button onClick={() => cargarParaEditar(r)}
                          style={{ padding: "8px 12px", background: "#fefce8", color: "#d97706", border: "1px solid #fde68a", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          ✏ Editar
                        </button>
                      )}
                      {user && user.rol === 1 && (
                        <button onClick={async () => {
                          if (!confirm("¿Eliminar este reporte? Esta acción no se puede deshacer.")) return;
                          await fetch(`/api/reportes-turno/${r._id}`, { method: "DELETE" });
                          setReportes(prev => prev.filter(x => x._id !== r._id));
                        }} style={{ padding: "8px 12px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ══ VISTA DETALLE ════════════════════════════════════════════════════ */}
        {view === "lista" && detalle && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
            onClick={() => setDetalle(null)}>
            <div style={{ background: "white", borderRadius: 16, padding: 24, maxWidth: 540, width: "100%", maxHeight: "80vh", overflowY: "auto" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: "#0f2847" }}>Detalle del reporte</h2>
                <button onClick={() => setDetalle(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}>✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 14 }}>
                <div><span style={S.label}>Técnico</span><p style={{ fontSize: 13 }}>{detalle.supervisorNombre}</p></div>
                <div><span style={S.label}>Turno</span><p style={{ fontSize: 13 }}>{detalle.turno}</p></div>
                <div><span style={S.label}>Fecha</span><p style={{ fontSize: 13 }}>{new Date(detalle.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })}</p></div>
                <div><span style={S.label}>OTs incluidas</span><p style={{ fontSize: 13 }}>{detalle.otIds.length}</p></div>
              </div>
              {detalle.recomendaciones.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <span style={S.label}>Novedades del turno</span>
                  {detalle.recomendaciones.map((n, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <span style={{ ...S.badge(PRIOR_COLOR[n.prioridad] ?? "#64748b"), flexShrink: 0 }}>{n.prioridad}</span>
                      <span style={{ fontSize: 12, color: "#334155" }}>{n.tag && <b>{n.tag} · </b>}{n.descripcion}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setDetalle(null)} style={S.btnGhost}>Cerrar</button>
                <button onClick={() => window.open(`/ordenes/turno-tecnico/${detalle._id}/imprimir`, "_blank")} style={S.btnGreen}>🖨 Generar PDF</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ VISTA NUEVO ══════════════════════════════════════════════════════ */}
        {view === "nuevo" && (
          <>
            <button onClick={() => { setEditandoId(null); setView("lista"); }} style={{ ...S.btnGhost, marginBottom: 12, fontSize: 13 }}>← Volver a lista</button>
            <Steps step={step} />

            {/* ── Step 1: Encabezado ── */}
            {step === 1 && (
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 16 }}>Encabezado del reporte</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px", marginBottom: 14 }}>
                  <div>
                    <label style={S.label}>Fecha</label>
                    <input type="date" value={form.fecha} onChange={e => patchForm({ fecha: e.target.value })} style={S.input} />
                  </div>
                  <div>
                    <label style={S.label}>Turno</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["Diurno", "Nocturno"] as TurnoTipo[]).map(t => (
                        <button key={t} type="button" onClick={() => patchForm({ turno: t })}
                          style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: form.turno === t ? 700 : 400, border: form.turno === t ? "2px solid #2563eb" : "1px solid #e2e8f0", background: form.turno === t ? "#eff6ff" : "white", color: form.turno === t ? "#1d4ed8" : "#64748b" }}>
                          {t === "Diurno" ? "☀️ Diurno" : "🌙 Nocturno"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Selector de área — visible para admin/sup o usuarios con múltiples áreas */}
                {(user && (user.rol <= 2 || (user.areas?.length ?? 0) > 1)) ? (
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>Área / Disciplina</label>
                    <select value={form.areaCodigo} onChange={e => patchForm({ areaCodigo: e.target.value })}
                      style={{ ...S.input, cursor: "pointer" }}>
                      <option value="">— Seleccionar área —</option>
                      {areas.filter(a => AREAS_ELEC_INST.has(a.codigo)).map(a => (
                        <option key={a.codigo} value={a.codigo}>
                          {a.codigo} — {a.nombre} ({disciplinaDeArea(a.codigo)})
                        </option>
                      ))}
                    </select>
                    {form.areaCodigo && (
                      <p style={{ fontSize: 12, color: "#2563eb", marginTop: 4, fontWeight: 600 }}>
                        Disciplina: {disciplinaDeArea(form.areaCodigo)}
                      </p>
                    )}
                  </div>
                ) : null}

                {/* Info técnico */}
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 4 }}>Técnico responsable</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f2847" }}>{user?.nombre}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {disciplina ? `${disciplina} · ` : ""}{areaEfectiva || "Sin área"}
                  </div>
                </div>

                {user && !areaEfectiva && (
                  <p style={{ fontSize: 12, color: "#dc2626", fontWeight: 600, marginBottom: 8 }}>
                    Sin área asignada — no se puede continuar. Selecciona un área o contacta al administrador.
                  </p>
                )}
                {user && areaEfectiva && !areaValida && (
                  <p style={{ fontSize: 12, color: "#dc2626", fontWeight: 600, marginBottom: 8 }}>
                    Este reporte es exclusivo de Eléctrico/Instrumentación — el área {areaEfectiva} no tiene reporte de turno técnico.
                  </p>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <button onClick={() => setStep(2)} style={S.btnPrimary}
                    disabled={!areaValida}>
                    Continuar → OTs
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: OTs del turno ── */}
            {step === 2 && (
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847" }}>OTs realizadas en el turno</div>
                    {/* Fecha prominente */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5, flexWrap: "wrap" as const }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: form.turno === "Diurno" ? "#d97706" : "#7c3aed" }}>
                        {form.turno === "Diurno" ? "☀️" : "🌙"} {form.turno}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#0f2847", letterSpacing: "0.03em" }}>
                        {new Date(form.fecha + "T12:00:00").toLocaleDateString("es-BO", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                      </span>
                      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{disciplina || areaEfectiva}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                      Solo OTs CMR y CMP del día seleccionado + plan de turno
                    </p>
                  </div>
                  {totalSeleccionadas > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#2563eb", background: "#eff6ff", borderRadius: 20, padding: "3px 10px", flexShrink: 0 }}>
                      {totalSeleccionadas} seleccionadas
                    </span>
                  )}
                </div>

                <input value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)}
                  placeholder="Filtrar por OT, TAG o descripción…" style={{ ...S.input, marginBottom: 14, fontSize: 13 }} />

                {loadingOTs ? (
                  <div style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Cargando OTs…</div>
                ) : (otsRegFiltradas.length === 0 && otsPlanFiltradas.length === 0) ? (
                  <div style={{ textAlign: "center", padding: 24, color: "#94a3b8", fontSize: 13 }}>
                    Sin OTs para este turno. Puedes continuar sin seleccionar ninguna.
                  </div>
                ) : (
                  <>
                    {/* ── OTs del plan semanal (normal) ── */}
                    {planNormal.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 8 }}>
                          Plan Semanal — {form.turno} ({planNormal.length})
                        </div>
                        {planNormal.map(o => {
                          const selId = o.id;
                          const sel = form.otsPlanIds.includes(selId);
                          const tipo = tipoOtDisplay(o.tipoOT);
                          return (
                            <div key={o.id} style={{ border: sel ? "2px solid #2563eb" : "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: sel ? "#f0f7ff" : "white", cursor: "pointer" }}
                              onClick={() => toggleOT(selId, true)}>
                              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                <input type="checkbox" checked={sel} onChange={() => toggleOT(selId, true)} style={{ marginTop: 3, accentColor: "#2563eb", width: 16, height: 16 }} onClick={e => e.stopPropagation()} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 3 }}>
                                    <span style={S.badge(tipo.color.color)}>{tipo.texto}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{o.numeroOT}</span>
                                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#1d4ed8" }}>{o.tag}</span>
                                    {o.hhTotal > 0 && <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>{o.hhTotal}h</span>}
                                  </div>
                                  <p style={{ fontSize: 12, color: "#475569" }}>{o.descripcion}</p>
                                  {o.personalAsignado.length > 0 && (
                                    <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>👤 {o.personalAsignado.join(", ")}</p>
                                  )}
                                  {sel && (
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                                      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                        <input type="checkbox" checked={form.otsCriticas.includes(selId)} onChange={() => toggleCritica(selId)} style={{ accentColor: "#dc2626" }} />
                                        <span style={{ color: "#dc2626", fontWeight: 600 }}>⚠ Crítica</span>
                                      </label>
                                      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                        <input type="checkbox" checked={form.otsPendientes.includes(selId)} onChange={() => togglePendiente(selId)} style={{ accentColor: "#d97706" }} />
                                        <span style={{ color: "#d97706", fontWeight: 600 }}>→ Pasa al siguiente turno</span>
                                      </label>
                                    </div>
                                  )}
                                  {sel && (
                                    <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#2563eb", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 3 }}>
                                        📝 Nota del técnico (columna PDF)
                                      </label>
                                      <input value={form.notasOTs[selId] ?? ""} onChange={e => patchForm({ notasOTs: { ...form.notasOTs, [selId]: e.target.value } })}
                                        placeholder="Ej: válvula operativa al 80%, pendiente ajuste fino…" style={{ ...S.input, fontSize: 12, borderColor: "#93c5fd" }} />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* ── Bitácora (OTs OPEPLANT/guardia) ── */}
                    {bitacora.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 8, marginTop: planNormal.length > 0 ? 12 : 0 }}>
                          Bitácora de Guardia — OPEPLANT ({bitacora.length})
                        </div>
                        {bitacora.map(o => {
                          const selId = o.id;
                          const sel = form.otsPlanIds.includes(selId);
                          return (
                            <div key={o.id} style={{ border: sel ? "2px solid #d97706" : "1px solid #fed7aa", borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: sel ? "#fffbeb" : "white", cursor: "pointer" }}
                              onClick={() => toggleOT(selId, true)}>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="checkbox" checked={sel} onChange={() => toggleOT(selId, true)} style={{ accentColor: "#d97706", width: 16, height: 16 }} onClick={e => e.stopPropagation()} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 7px" }}>🔄 OPEPLANT</span>
                                    <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{o.numeroOT}</span>
                                    {o.ordenTrabajoNum && <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>OT #{o.ordenTrabajoNum}</span>}
                                  </div>
                                  <p style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{o.descripcion || "Guardia de turno"}</p>
                                  {o.hijasReales && o.hijasReales.length > 0 ? (
                                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column" as const, gap: 4 }} onClick={e => e.stopPropagation()}>
                                      {o.hijasReales.map(h => {
                                        const linea = h.lineas[0];
                                        return (
                                          <div key={h._id} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 9px" }}>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
                                              <span style={{ fontSize: 10, fontWeight: 700, color: "#166534" }}>✓ Registrado en el sistema</span>
                                              {linea?.tag && <span style={{ fontFamily: "monospace", fontSize: 11, color: "#1d4ed8" }}>{linea.tag}</span>}
                                              {linea?.tiempoRealHrs != null && linea.tiempoRealHrs > 0 && (
                                                <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>{linea.tiempoRealHrs}h</span>
                                              )}
                                            </div>
                                            <p style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                                              {linea?.sintoma ?? linea?.descripcionEquipo ?? linea?.descripcionTrabajo ?? "—"}
                                            </p>
                                            {linea?.resolucionAplicada && (
                                              <p style={{ fontSize: 11, color: "#16a34a", fontStyle: "italic" as const, marginTop: 2 }}>✓ {linea.resolucionAplicada}</p>
                                            )}
                                            {h.tecnicos.length > 0 && (
                                              <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>👤 {h.tecnicos.map(t => t.nombreCompleto).join(", ")}</p>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p style={{ fontSize: 11, color: "#b45309", marginTop: 4, fontStyle: "italic" as const }}>Aún sin OT registrada en el sistema para este N° OT.</p>
                                  )}
                                  {o.ordenTrabajoId && (
                                    <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
                                      {opeplantCerrada.has(o.ordenTrabajoId) ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46", background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 5, padding: "3px 10px" }}>
                                          ✓ Enviada a revisión
                                        </span>
                                      ) : (
                                        <button
                                          disabled={cerrandoOpeplant.has(o.ordenTrabajoId)}
                                          onClick={() => cerrarOpeplant(o.ordenTrabajoId!)}
                                          style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", background: cerrandoOpeplant.has(o.ordenTrabajoId) ? "#e5e7eb" : "#d97706", color: cerrandoOpeplant.has(o.ordenTrabajoId) ? "#6b7280" : "white", border: "none", borderRadius: 5, cursor: cerrandoOpeplant.has(o.ordenTrabajoId) ? "default" : "pointer" }}>
                                          {cerrandoOpeplant.has(o.ordenTrabajoId) ? "Cerrando…" : "📋 Cerrar OPEPLANT"}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {o.hhTotal > 0 && <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, flexShrink: 0 }}>{o.hhTotal}h</span>}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* ── OTs registradas del día ── */}
                    {otsRegFiltradas.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 8, marginTop: (planNormal.length > 0 || bitacora.length > 0) ? 12 : 0 }}>
                          CMR / CMP registrados en el sistema ({otsRegFiltradas.length})
                        </div>
                        {otsRegFiltradas.map(o => {
                          const sel = form.otIds.includes(o._id);
                          const linea = o.lineas[0];
                          const tipo = linea?.tipoOT ? tipoOtDisplay(linea.tipoOT) : null;
                          return (
                            <div key={o._id} style={{ border: sel ? "2px solid #16a34a" : "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: sel ? "#f0fdf4" : "white", cursor: "pointer" }}
                              onClick={() => toggleOT(o._id, false)}>
                              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                <input type="checkbox" checked={sel} onChange={() => toggleOT(o._id, false)} style={{ marginTop: 3, accentColor: "#16a34a", width: 16, height: 16 }} onClick={e => e.stopPropagation()} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 3 }}>
                                    <span style={S.badge(tipo?.color.color ?? "#64748b")}>{tipo?.texto ?? "—"}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{o.otJdeNumero ?? `#${o.numeroOT}`}</span>
                                    {o.otJdeNumero && <span style={{ fontSize: 11, color: "#94a3b8" }}>#{o.numeroOT}</span>}
                                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#1d4ed8" }}>{linea?.tag}</span>
                                    {linea?.tiempoRealHrs && <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>{linea.tiempoRealHrs}h</span>}
                                    <span style={{ fontSize: 10, color: "#94a3b8" }}>
                                      📅 {new Date(o.fecha).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}
                                    </span>
                                  </div>
                                  <p style={{ fontSize: 12, color: "#475569" }}>
                                    {linea?.descripcionEquipo ?? linea?.sintoma ?? linea?.descripcionTrabajo ?? "—"}
                                  </p>
                                  {sel && (
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                                      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                        <input type="checkbox" checked={form.otsCriticas.includes(o._id)} onChange={() => toggleCritica(o._id)} style={{ accentColor: "#dc2626" }} />
                                        <span style={{ color: "#dc2626", fontWeight: 600 }}>⚠ Crítica</span>
                                      </label>
                                      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                        <input type="checkbox" checked={form.otsPendientes.includes(o._id)} onChange={() => togglePendiente(o._id)} style={{ accentColor: "#d97706" }} />
                                        <span style={{ color: "#d97706", fontWeight: 600 }}>→ Pasa al siguiente turno</span>
                                      </label>
                                    </div>
                                  )}
                                  {sel && (
                                    <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#2563eb", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 3 }}>
                                        📝 Nota del técnico (columna PDF)
                                      </label>
                                      <input value={form.notasOTs[o._id] ?? ""} onChange={e => patchForm({ notasOTs: { ...form.notasOTs, [o._id]: e.target.value } })}
                                        placeholder="Ej: válvula operativa al 80%, pendiente ajuste fino…" style={{ ...S.input, fontSize: 12, borderColor: "#93c5fd" }} />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* ── OTs en continuación (en_proceso de días anteriores) ── */}
                    {otsContinuacionFiltradas.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 8, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                          <span>⏳ En continuación — días anteriores ({otsContinuacionFiltradas.length})</span>
                        </div>
                        {otsContinuacionFiltradas.map(o => {
                          const sel = form.otIds.includes(o._id);
                          const linea = o.lineas[0];
                          const tipo = linea?.tipoOT ? tipoOtDisplay(linea.tipoOT) : null;
                          const fechaOT = new Date(o.fecha).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
                          return (
                            <div key={o._id} style={{ border: sel ? "2px solid #7c3aed" : "1px solid #ddd6fe", borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: sel ? "#faf5ff" : "#fefcff", cursor: "pointer" }}
                              onClick={() => toggleOT(o._id, false)}>
                              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                <input type="checkbox" checked={sel} onChange={() => toggleOT(o._id, false)} style={{ marginTop: 3, accentColor: "#7c3aed", width: 16, height: 16 }} onClick={e => e.stopPropagation()} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 3 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, background: "#ede9fe", color: "#7c3aed", borderRadius: 4, padding: "1px 6px" }}>Desde {fechaOT}</span>
                                    <span style={S.badge(tipo?.color.color ?? "#64748b")}>{tipo?.texto ?? "—"}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{o.otJdeNumero ?? `#${o.numeroOT}`}</span>
                                    {o.otJdeNumero && <span style={{ fontSize: 11, color: "#94a3b8" }}>#{o.numeroOT}</span>}
                                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#1d4ed8" }}>{linea?.tag}</span>
                                  </div>
                                  <p style={{ fontSize: 12, color: "#475569" }}>
                                    {linea?.descripcionEquipo ?? linea?.sintoma ?? linea?.descripcionTrabajo ?? "—"}
                                  </p>
                                  <p style={{ fontSize: 11, color: "#7c3aed", marginTop: 2 }}>
                                    👤 {o.tecnicos.map(t => t.nombreCompleto).join(", ")}
                                  </p>
                                  {sel && (
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                                      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                        <input type="checkbox" checked={form.otsCriticas.includes(o._id)} onChange={() => toggleCritica(o._id)} style={{ accentColor: "#dc2626" }} />
                                        <span style={{ color: "#dc2626", fontWeight: 600 }}>⚠ Crítica</span>
                                      </label>
                                      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12 }}>
                                        <input type="checkbox" checked={form.otsPendientes.includes(o._id)} onChange={() => togglePendiente(o._id)} style={{ accentColor: "#d97706" }} />
                                        <span style={{ color: "#d97706", fontWeight: 600 }}>→ Pasa al siguiente turno</span>
                                      </label>
                                    </div>
                                  )}
                                  {sel && (
                                    <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                                      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#2563eb", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 3 }}>
                                        📝 Nota del técnico (columna PDF)
                                      </label>
                                      <input value={form.notasOTs[o._id] ?? ""} onChange={e => patchForm({ notasOTs: { ...form.notasOTs, [o._id]: e.target.value } })}
                                        placeholder="Ej: válvula operativa al 80%, pendiente ajuste fino…" style={{ ...S.input, fontSize: 12, borderColor: "#93c5fd" }} />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                  <button onClick={() => setStep(1)} style={S.btnGhost}>← Encabezado</button>
                  <button onClick={() => setStep(3)} style={S.btnPrimary}>Continuar → Novedades</button>
                </div>
              </div>
            )}

            {/* ── Step 3: Novedades ── */}
            {step === 3 && (
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 6 }}>Novedades del turno</div>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                  Registra alertas, observaciones o pendientes importantes para el siguiente turno.
                </p>

                {form.novedades.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    {form.novedades.map((n, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6 }}>
                        <span style={{ ...S.badge(PRIOR_COLOR[n.prioridad] ?? "#64748b"), flexShrink: 0 }}>{n.prioridad}</span>
                        <div style={{ flex: 1 }}>
                          {n.tag && <span style={{ fontSize: 11, fontFamily: "monospace", color: "#1d4ed8", marginRight: 6 }}>{n.tag}</span>}
                          <span style={{ fontSize: 13, color: "#1e293b" }}>{n.descripcion}</span>
                        </div>
                        <button type="button" onClick={() => patchForm({ novedades: form.novedades.filter((_, j) => j !== i) })}
                          style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 8 }}>
                    <div>
                      <label style={S.label}>Nivel</label>
                      <select value={novInput.prioridad} onChange={e => setNovInput(n => ({ ...n, prioridad: e.target.value as "URGENTE" | "ATENCION" | "INFORMACION" }))}
                        style={{ ...S.input, cursor: "pointer" }}>
                        <option value="URGENTE">🚨 URGENTE</option>
                        <option value="ATENCION">⚠️ ATENCIÓN</option>
                        <option value="INFORMACION">ℹ️ INFORMACIÓN</option>
                      </select>
                    </div>
                    <div style={{ position: "relative" }}>
                      <label style={S.label}>TAG / EQUIPO <span style={{ fontWeight: 400 }}>(opcional)</span></label>
                      <div style={{ position: "relative" }}>
                        <input
                          value={novInput.tag || tagQuery}
                          onChange={e => {
                            const v = e.target.value.toUpperCase();
                            setTagQuery(v);
                            setNovInput(n => ({ ...n, tag: "" }));
                            setTagDropdown(v.length >= 2);
                          }}
                          onFocus={() => { if ((novInput.tag || tagQuery).length >= 2) setTagDropdown(true); }}
                          onBlur={() => setTimeout(() => setTagDropdown(false), 180)}
                          placeholder="Buscar TAG..."
                          style={{ ...S.input, fontFamily: "monospace", paddingRight: 28 }}
                        />
                        {(novInput.tag || tagQuery) && (
                          <button type="button"
                            onClick={() => { setNovInput(n => ({ ...n, tag: "" })); setTagQuery(""); setTagDropdown(false); }}
                            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>
                            ✕
                          </button>
                        )}
                      </div>
                      {tagDropdown && (
                        <div style={{ position: "absolute", zIndex: 300, left: 0, right: 0, top: "100%", background: "white", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 20px rgba(15,40,71,0.12)", maxHeight: 200, overflowY: "auto" as const }}>
                          {todosLosTags.filter(t => t.includes(tagQuery)).slice(0, 40).map(t => (
                            <button key={t} type="button"
                              onMouseDown={() => { setNovInput(n => ({ ...n, tag: t })); setTagQuery(""); setTagDropdown(false); }}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontFamily: "monospace", fontSize: 13, border: "none", background: "transparent", cursor: "pointer", color: "#1e293b", borderBottom: "1px solid #f8fafc" }}>
                              {t}
                            </button>
                          ))}
                          {todosLosTags.filter(t => t.includes(tagQuery)).length === 0 && (
                            <p style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Sin resultados</p>
                          )}
                        </div>
                      )}
                      {novInput.tag && (
                        <div style={{ marginTop: 3, fontSize: 11, color: "#1d4ed8", fontFamily: "monospace", fontWeight: 700 }}>✓ {novInput.tag}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={S.label}>Descripción / Novedad</label>
                    <textarea value={novInput.descripcion} onChange={e => setNovInput(n => ({ ...n, descripcion: e.target.value }))}
                      placeholder="Describe la novedad, alerta o pendiente para el siguiente turno…"
                      style={S.textarea} />
                  </div>
                  <button type="button" onClick={agregarNovedad} disabled={!novInput.descripcion.trim()}
                    style={{ ...S.btnPrimary, opacity: novInput.descripcion.trim() ? 1 : 0.5, padding: "8px 16px", fontSize: 13 }}>
                    + Agregar novedad
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button onClick={() => setStep(2)} style={S.btnGhost}>← OTs</button>
                  <button onClick={() => setStep(4)} style={S.btnPrimary}>Revisar y generar PDF →</button>
                </div>
              </div>
            )}

            {/* ── Step 4: Revisión y PDF ── */}
            {step === 4 && (
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 16 }}>Revisión del reporte</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 16 }}>
                  <div><span style={S.label}>Técnico</span><p style={{ fontSize: 14 }}>{user?.nombre}</p></div>
                  <div><span style={S.label}>Turno</span><p style={{ fontSize: 14 }}>{form.turno}</p></div>
                  <div><span style={S.label}>Fecha</span><p style={{ fontSize: 14 }}>{form.fecha}</p></div>
                  <div><span style={S.label}>Disciplina / Área</span><p style={{ fontSize: 14, color: "#2563eb", fontWeight: 700 }}>{disciplina || areaEfectiva}</p></div>
                  <div><span style={S.label}>OTs plan seleccionadas</span><p style={{ fontSize: 14, fontWeight: 700, color: "#2563eb" }}>{form.otsPlanIds.length}</p></div>
                  <div><span style={S.label}>OTs registradas</span><p style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>{form.otIds.length}</p></div>
                </div>

                {form.novedades.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <span style={S.label}>Novedades ({form.novedades.length})</span>
                    {form.novedades.map((n, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 8px", marginBottom: 4 }}>
                        <span style={{ ...S.badge(PRIOR_COLOR[n.prioridad] ?? "#64748b"), fontSize: 10 }}>{n.prioridad}</span>
                        <span style={{ fontSize: 12 }}>{n.tag && <b>{n.tag} · </b>}{n.descripcion}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ background: editandoId ? "#fefce8" : "#f0fdf4", border: `1px solid ${editandoId ? "#fde68a" : "#bbf7d0"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
                  <p style={{ fontSize: 13, color: editandoId ? "#92400e" : "#166534" }}>
                    {editandoId
                      ? "Se guardarán los cambios en el reporte existente. El PDF actualizado estará disponible desde la lista."
                      : "Al guardar se generará el PDF del reporte de turno. No requiere aprobación del supervisor."}
                  </p>
                </div>

                {submitErr && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>⚠ {submitErr}</p>}

                <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                  <button onClick={() => setStep(3)} style={S.btnGhost} disabled={submitting}>← Novedades</button>
                  <button onClick={submit} style={S.btnGreen} disabled={submitting}>
                    {submitting ? "Guardando…" : editandoId ? "💾 Guardar cambios" : "🖨 Guardar y generar PDF"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
