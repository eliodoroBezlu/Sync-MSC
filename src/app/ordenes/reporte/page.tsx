"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { generarInformeOT } from "@/lib/generarInformeOT";
import { estaEnVentanaCierreSemanal } from "@/lib/turno";
import { getWeekNumber } from "@/lib/semana";
import { tipoOtDisplay } from "@/lib/tiposOt";

// ─── Utilidades de imagen ─────────────────────────────────────────────────────

async function comprimirImagen(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

type EstadoOT = "borrador" | "en_proceso" | "pendiente_revision" | "solicitar_correccion" | "revisado" | "concluido";

type InspeccionItem = { descripcion: string; ok: boolean; obs: string };
type Inspeccion = { checklistId: string; checklistNombre: string; items: InspeccionItem[] };

type AdjuntoLinea = {
  tipo: "foto" | "documento";
  nombre: string;
  dataUrl: string;
  comentario: string;
  comentariosExtra: string[];
};

type Linea = {
  tag: string;
  descripcionEquipo: string;
  tipoOT: string;
  sintoma?: string;
  causaProbable?: string;
  resolucionAplicada?: string;
  estadoFinal?: string;
  tiempoEstimadoHrs?: number;
  tiempoRealHrs?: number;
  descripcionTrabajo?: string;
  tareasEjecutadas?: string[];
  observaciones?: string;
  inspeccion?: Inspeccion | null;
  adjuntos?: AdjuntoLinea[];
};

const ESTADO_FINAL_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: "operativo",      label: "Operativo",              color: "#16a34a" },
  { value: "operativo_obs",  label: "Operativo c/ observación", color: "#d97706" },
  { value: "pendiente",      label: "Pendiente",              color: "#2563eb" },
  { value: "fuera_servicio", label: "Fuera de servicio",      color: "#dc2626" },
];

type SupForm = {
  requierePlanificacion: boolean; // "Requiere WR" en UI
  comentariosSupervisor: string;  // separado por "\n" para múltiples comentarios
  generaOtHallazgo: boolean | null;
  otGenerada: string;
};

type RegistroDiario = {
  _id?: string;
  fecha: string;
  tecnico: string;
  usuarioId?: string;
  hhTrabajadas: number;
  tareasEjecutadas: string[];
  observaciones?: string;
  adjuntos?: { tipo: "foto" | "documento"; nombre: string; dataUrl: string; comentario: string; comentariosExtra: string[] }[];
};

type OTDoc = {
  _id: string;
  numeroOT: string;
  fecha: string;
  turno: string;
  areaCodigo: string;
  tecnicos: { usuarioId: string; nombreCompleto: string }[];
  lineas: Linea[];
  estado: EstadoOT;
  cerradaDefinitiva?: boolean;
  esRecurrente?: boolean;
  datosSupervision: Partial<SupForm> & { codigoModoFallaISO?: string; revisadoPor?: string; revisadoEn?: string };
  historialCambios: { fechaHora: string; usuarioId: string; nombreUsuario: string; cambio: string }[];
  registrosDiarios?: RegistroDiario[];
  // Enlace al plan semanal
  origenPlan?: boolean;
  programacionSemanalId?: string;
  otJdeNumero?: string;
  otJdeDia?: string;
  createdAt?: string;
  hhEstimadasPlan?: number; // HH del plan semanal para OPEPLANT (override en PDF)
};

type AreaOpt = { codigo: string; nombre: string };

function normalizarNombre(nombre: string): string {
  return nombre.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
}

// Un técnico "pertenece" a la OT si está en el roster estático (ot.tecnicos) O si ya
// registró al menos un avance (ot.registrosDiarios). En OTs de larga duración es común
// que un técnico distinto al roster original cargue avances en semanas posteriores; si
// solo miráramos ot.tecnicos, la OT desaparecería de su lista y perdería permisos de
// edición sobre su propio trabajo ya guardado.
function esTecnicoDeLaOt(
  ot: { tecnicos: { usuarioId: string; nombreCompleto: string }[]; registrosDiarios?: RegistroDiario[] },
  user: { id?: string; nombre?: string } | null
): boolean {
  if (!user) return false;
  const tokensUser = normalizarNombre(user.nombre ?? "").split(/\s+/).filter(t => t.length > 2);
  const coincideNombre = (nombreCompleto: string) => tokensUser.some(tok => normalizarNombre(nombreCompleto).includes(tok));
  const enRoster = ot.tecnicos.some(t => (t.usuarioId && t.usuarioId === user.id) || coincideNombre(t.nombreCompleto));
  if (enRoster) return true;
  return (ot.registrosDiarios ?? []).some(r => (r.usuarioId && r.usuarioId === user.id) || coincideNombre(r.tecnico));
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ESTADO_COLOR: Record<string, string> = {
  borrador: "#64748b",
  en_proceso: "#7c3aed",
  pendiente_revision: "#d97706",
  solicitar_correccion: "#dc2626",
  revisado: "#2563eb",
  concluido: "#16a34a",
};

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  en_proceso: "En proceso",
  pendiente_revision: "Pend. revisión",
  solicitar_correccion: "Corrección",
  revisado: "Revisado",
  concluido: "Concluido",
};

function tipoColor(tipoOT: string): string {
  return tipoOtDisplay(tipoOT).color.color;
}

const CLASIFICACIONES_RCM = [
  "Correctivo No Planificado",
  "Correctivo Programado",
  "Mantenimiento Menor",
  "Mantenimiento Mayor",
];

const EMPTY_SUP: SupForm = {
  requierePlanificacion: false,
  comentariosSupervisor: "", generaOtHallazgo: null, otGenerada: "",
};

const COLS_TABLERO: { key: EstadoOT; label: string; color: string }[] = [
  { key: "borrador",             label: "Borradores",       color: "#64748b" },
  { key: "en_proceso",           label: "En proceso",       color: "#7c3aed" },
  { key: "pendiente_revision",   label: "Pend. Revisión",   color: "#d97706" },
  { key: "solicitar_correccion", label: "Corrección",       color: "#dc2626" },
  { key: "revisado",             label: "Revisado",         color: "#2563eb" },
  { key: "concluido",            label: "Concluido",        color: "#16a34a" },
];

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  page: { minHeight: "100vh", background: "#f1f5f9" },
  wrap: { maxWidth: 860, margin: "0 auto", padding: "20px 16px 56px" },
  card: {
    background: "white", borderRadius: 12,
    border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 12,
  },
  label: {
    display: "block" as const, fontSize: 11, fontWeight: 700, color: "#64748b",
    letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 5,
  },
  input: {
    width: "100%", border: "1px solid #cbd5e1", borderRadius: 8,
    padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none",
    boxSizing: "border-box" as const, background: "white",
  },
  inputSm: {
    border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 9px",
    fontSize: 13, color: "#1e293b", outline: "none",
    background: "#fffbeb", width: 90,
  },
  select: {
    width: "100%", border: "1px solid #cbd5e1", borderRadius: 8,
    padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none",
    boxSizing: "border-box" as const, background: "white", cursor: "pointer",
  },
  textarea: {
    width: "100%", border: "1px solid #cbd5e1", borderRadius: 8,
    padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none",
    boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 72, background: "white",
  },
  textareaSm: {
    border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 9px",
    fontSize: 13, color: "#1e293b", outline: "none", resize: "vertical" as const,
    background: "#fffbeb", width: "100%", minHeight: 52, boxSizing: "border-box" as const,
  },
  badge: (color: string) => ({
    display: "inline-block" as const, background: color + "18", color,
    border: `1px solid ${color}40`, borderRadius: 5, padding: "2px 8px",
    fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap" as const,
  }),
  btnPrimary: { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGreen:   { background: "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnRed:     { background: "#dc2626", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnAmber:   { background: "#d97706", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGhost:   { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function diffLineas(original: Linea[], editado: Linea[]): string[] {
  const msgs: string[] = [];
  editado.forEach((linea, i) => {
    const orig = original[i];
    if (!orig) return;
    if (linea.tiempoEstimadoHrs !== orig.tiempoEstimadoHrs) {
      msgs.push(`[${linea.tag}] HH estimadas: ${orig.tiempoEstimadoHrs ?? "—"}HH → ${linea.tiempoEstimadoHrs ?? "—"}HH`);
    }
    if (linea.tiempoRealHrs !== orig.tiempoRealHrs) {
      msgs.push(`[${linea.tag}] HH trabajadas: ${orig.tiempoRealHrs ?? "—"}HH → ${linea.tiempoRealHrs ?? "—"}HH`);
    }
    if (linea.resolucionAplicada !== orig.resolucionAplicada) {
      msgs.push(`[${linea.tag}] Resolución actualizada`);
    }
    if (linea.observaciones !== orig.observaciones) {
      msgs.push(`[${linea.tag}] Observaciones actualizadas`);
    }
  });
  return msgs.length > 0 ? ["Edición con trazabilidad:", ...msgs] : ["Sin cambios detectados"];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReporteOTPage() {
  const { user } = useUser();
  const [otParamId, setOtParamId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOtParamId(params.get("ot"));
    const buscar = params.get("buscar");
    if (buscar) setFiltroBuscar(buscar);
  }, []);

  // Derivados de rol — Admin(1) y Superintendente(2) tienen acceso total
  const esTecnico   = user?.rol === 4 || user?.rol === 6; // rol 6 = Contratista, mismos permisos que técnico
  const esSup       = user ? user.rol <= 3 || user.rol === 5 : false; // 1, 2, 3 y 5 pueden revisar
  const esAdmin     = user?.rol === 1;

  const [ordenes, setOrdenes] = useState<OTDoc[]>([]);
  const [loadError, setLoadError] = useState("");
  const [areas, setAreas] = useState<AreaOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OTDoc | null>(null);
  const [viewMode, setViewMode] = useState<"lista" | "tablero">("lista");

  // ─── Helpers de fechas para filtros de período ───────────────────────────────
  function hoy() { return new Date().toISOString().split("T")[0]; }
  function restarDias(n: number) {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }
  function lunesDeEstaSemana() {
    const d = new Date();
    const dia = d.getDay() === 0 ? 6 : d.getDay() - 1; // lunes=0
    d.setDate(d.getDate() - dia);
    return d.toISOString().split("T")[0];
  }
  function lunesDeSemanaAnterior() {
    const d = new Date();
    const dia = d.getDay() === 0 ? 6 : d.getDay() - 1;
    d.setDate(d.getDate() - dia - 7);
    return d.toISOString().split("T")[0];
  }
  function domingoSemanaAnterior() {
    const d = new Date();
    const dia = d.getDay() === 0 ? 6 : d.getDay() - 1;
    d.setDate(d.getDate() - dia - 1);
    return d.toISOString().split("T")[0];
  }

  type Periodo = "3semanas" | "semana" | "semana_ant" | "mes" | "personalizado" | "todo";

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroBuscar, setFiltroBuscar] = useState("");
  // Capa 1 & 2 — Filtro de período (default: últimas 3 semanas)
  const [periodo, setPeriodo] = useState<Periodo>("3semanas");
  const [filtroFechaDesde, setFiltroFechaDesde] = useState(restarDias(21));
  const [filtroFechaHasta, setFiltroFechaHasta] = useState("");

  // Supervisión
  const [supForm, setSupForm] = useState<SupForm>(EMPTY_SUP);
  const [supComentarioInput, setSupComentarioInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  // Modo edición con trazabilidad
  const [editMode, setEditMode] = useState(false);
  const [editLineas, setEditLineas] = useState<Linea[]>([]);
  const [editOtJdeNumero, setEditOtJdeNumero] = useState("");
  const [editTurno, setEditTurno] = useState("");
  const [editFecha, setEditFecha] = useState("");
  const [editTecnicos, setEditTecnicos] = useState<{ usuarioId: string; nombreCompleto: string }[]>([]);
  const [usuariosDisponibles, setUsuariosDisponibles] = useState<{ _id: string; nombre: string }[]>([]);
  const [tareaInputs, setTareaInputs] = useState<string[]>([]);
  const [itemCheckInputs, setItemCheckInputs] = useState<string[]>([]);

  // Eliminar OT (solo admin)
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Eliminar avance diario (supervisor/admin)
  const [deletingAvanceId, setDeletingAvanceId] = useState<string | null>(null);
  // Editar avance diario (supervisor/admin)
  const [editingAvanceId, setEditingAvanceId] = useState<string | null>(null);
  const [editAvanceForm, setEditAvanceForm] = useState<{ fecha: string; hhTrabajadas: number; tareasEjecutadas: string[]; observaciones: string; tareaInput: string; adjuntos: { tipo: "foto" | "documento"; nombre: string; dataUrl: string; comentario: string; comentariosExtra: string[] }[] }>({ fecha: "", hhTrabajadas: 0, tareasEjecutadas: [], observaciones: "", tareaInput: "", adjuntos: [] });
  const [cargandoAdjAvance, setCargandoAdjAvance] = useState(false);

  // Reabrir OT (solo admin)
  const [showReabrir, setShowReabrir] = useState(false);
  const [reabrirRazon, setReabrirRazon] = useState("");
  const [savingReabrir, setSavingReabrir] = useState(false);

  // Cierre definitivo al concluir (OT recurrente que ya no va a continuar)
  const [cierreDefinitivo, setCierreDefinitivo] = useState(false);

  // Modal agregar evidencia (foto/documento) desde panel supervisor
  const [evidenciaModal, setEvidenciaModal] = useState<{ lineaTag: string; lineaTipoOT: string } | null>(null);
  const [evidenciaComentario, setEvidenciaComentario] = useState("");
  const [evidenciaPreview, setEvidenciaPreview] = useState<{ dataUrl: string; nombre: string; tipo: "foto" | "documento" } | null>(null);
  const [evidenciaSaving, setEvidenciaSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Avance diario (OTs multi-día)
  const [showAvance, setShowAvance]   = useState(false);
  const [avanceTareaInput, setAvanceTareaInput] = useState("");
  const [avanceForm, setAvanceForm]   = useState<{
    fecha: string; hhTrabajadas: number; tareasEjecutadas: string[]; observaciones: string;
    adjuntos: { tipo: "foto" | "documento"; nombre: string; dataUrl: string; comentario: string; comentariosExtra: string[] }[];
  }>({ fecha: new Date().toISOString().split("T")[0], hhTrabajadas: 0, tareasEjecutadas: [], observaciones: "", adjuntos: [] });

  const loadOrdenes = useCallback(async (buscarDirecto?: string) => {
    setLoading(true);
    if (!buscarDirecto) setLoadError("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (buscarDirecto) {
        // Búsqueda directa por número de OT — bypassa filtros de visibilidad
        params.set("buscarNumero", buscarDirecto);
      } else {
        if (filtroEstado) params.set("estado", filtroEstado);
        if (filtroArea) params.set("area", filtroArea);
        if (filtroFechaDesde) params.set("fechaDesde", filtroFechaDesde);
        if (filtroFechaHasta) params.set("fechaHasta", filtroFechaHasta);
        if (periodo === "todo") params.set("incluirArchivados", "true");
      }
      const res = await fetch(`/api/ordenes?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (buscarDirecto) {
        // Fusionar resultado de búsqueda directa sin reemplazar toda la lista
        if (Array.isArray(data) && data.length > 0) {
          setOrdenes(prev => {
            const ids = new Set(prev.map(o => o._id));
            const nuevas = data.filter((o: OTDoc) => !ids.has(o._id));
            return [...prev, ...nuevas];
          });
        }
      } else {
        setOrdenes(Array.isArray(data) ? data : []);
      }
    } catch {
      if (!buscarDirecto) {
        setOrdenes([]);
        setLoadError("No se pudo cargar la lista de OTs. Verifica tu conexión e intenta ↻ Actualizar.");
      }
    }
    finally { setLoading(false); }
  }, [filtroEstado, filtroArea, filtroFechaDesde, filtroFechaHasta, periodo]);

  useEffect(() => { fetch("/api/areas").then((r) => r.json()).then(setAreas).catch(() => {}); }, []);
  useEffect(() => { loadOrdenes(); }, [loadOrdenes]);

  // Búsqueda directa cuando el usuario escribe un número exacto de OT (6 dígitos)
  useEffect(() => {
    const num = filtroBuscar.trim();
    if (/^\d{4,6}$/.test(num)) {
      loadOrdenes(num);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroBuscar]);

  // Auto-seleccionar OT si viene el parámetro ?ot=<id> desde programa semanal
  useEffect(() => {
    if (!otParamId || ordenes.length === 0 || loading) return;
    const match = ordenes.find((o) => o._id === otParamId);
    if (match) setSelected(match);
  }, [otParamId, ordenes, loading]);

  useEffect(() => {
    if (!selected) { setEditMode(false); return; }
    const d = selected.datosSupervision ?? {};
    setSupForm({
      requierePlanificacion: d.requierePlanificacion ?? false,
      comentariosSupervisor: d.comentariosSupervisor ?? "",
      generaOtHallazgo: (d as { generaOtHallazgo?: boolean | null }).generaOtHallazgo ?? null,
      otGenerada: (d as { otGenerada?: string }).otGenerada ?? "",
    });
    setSaveErr("");
    setEditMode(false);
    setCierreDefinitivo(false);
    // Refrescar datos de la OT para mostrar avances actualizados
    const id = selected._id;
    fetch(`/api/ordenes/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?._id) {
          setSelected((prev) => prev?._id === id ? data : prev);
          setOrdenes(prev => prev.map(o => o._id === id ? data : o));
        }
      })
      .catch(() => { /* mantener datos cacheados si falla */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?._id]);

  // Avisar antes de cerrar/recargar la pestaña si hay una edición sin guardar
  useEffect(() => {
    if (!editMode) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hayCambiosSinGuardar()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, editLineas, editOtJdeNumero, editTurno, editFecha, editTecnicos]);

  const ordenesFiltradas = ordenes.filter((o) => {
    // Técnico/Contratista solo ve sus propias OTs
    if (esTecnico && user) {
      if (!esTecnicoDeLaOt(o, user)) return false;
    }
    // Supervisor con áreas asignadas solo ve OTs de sus áreas
    if (user && user.rol === 3 && user.areas && user.areas.length > 0) {
      if (!user.areas.includes(o.areaCodigo)) return false;
    }
    if (!filtroBuscar) return true;
    const q = filtroBuscar.toLowerCase();
    return (
      o.numeroOT.toLowerCase().includes(q) ||
      (o.otJdeNumero ?? "").toLowerCase().includes(q) ||
      o.tecnicos.some((t) => t.nombreCompleto.toLowerCase().includes(q)) ||
      o.lineas.some((l) => l.tag.toLowerCase().includes(q))
    );
  });

  function areaNombre(codigo: string) { return areas.find((a) => a.codigo === codigo)?.nombre ?? codigo; }
  function patchSup(p: Partial<SupForm>) { setSupForm((f) => ({ ...f, ...p })); }

  function enterEditMode() {
    if (!selected) return;
    setEditLineas(selected.lineas.map((l) => ({ ...l })));
    setTareaInputs(selected.lineas.map(() => ""));
    setItemCheckInputs(selected.lineas.map(() => ""));
    setEditOtJdeNumero(selected.otJdeNumero ?? "");
    setEditTurno(selected.turno ?? "");
    setEditFecha(selected.fecha ? new Date(selected.fecha).toISOString().split("T")[0] : "");
    setEditTecnicos(selected.tecnicos.map(t => ({ usuarioId: t.usuarioId ?? "", nombreCompleto: t.nombreCompleto })));
    fetch(`/api/usuarios?rol=4,6&area=${selected.areaCodigo}&all=true`).then(r => r.json()).then(setUsuariosDisponibles).catch(() => {});
    setEditMode(true);
  }

  function addTareaLinea(i: number) {
    const val = tareaInputs[i]?.trim();
    if (!val) return;
    const prev = editLineas[i].tareasEjecutadas ?? [];
    patchLinea(i, { tareasEjecutadas: [...prev, val] });
    setTareaInputs((ts) => ts.map((t, ii) => (ii === i ? "" : t)));
  }

  function removeTareaLinea(lineaIdx: number, tareaIdx: number) {
    const prev = editLineas[lineaIdx].tareasEjecutadas ?? [];
    patchLinea(lineaIdx, { tareasEjecutadas: prev.filter((_, ii) => ii !== tareaIdx) });
  }

  function getOrCreateInspeccion(l: Linea): Inspeccion {
    return l.inspeccion ?? { checklistId: "", checklistNombre: "Checklist supervisión", items: [] };
  }

  function addItemChecklist(i: number) {
    const val = itemCheckInputs[i]?.trim();
    if (!val) return;
    const insp = getOrCreateInspeccion(editLineas[i]);
    const orden = insp.items.length;
    patchLinea(i, { inspeccion: { ...insp, items: [...insp.items, { descripcion: val, ok: false, obs: "" }] } });
    setItemCheckInputs((ts) => ts.map((t, ii) => (ii === i ? "" : t)));
    void orden;
  }

  function toggleItemChecklist(lineaIdx: number, itemIdx: number) {
    const insp = getOrCreateInspeccion(editLineas[lineaIdx]);
    const items = insp.items.map((it, ii) => ii === itemIdx ? { ...it, ok: !it.ok } : it);
    patchLinea(lineaIdx, { inspeccion: { ...insp, items } });
  }

  function editObsChecklist(lineaIdx: number, itemIdx: number, obs: string) {
    const insp = getOrCreateInspeccion(editLineas[lineaIdx]);
    const items = insp.items.map((it, ii) => ii === itemIdx ? { ...it, obs } : it);
    patchLinea(lineaIdx, { inspeccion: { ...insp, items } });
  }

  function removeItemChecklist(lineaIdx: number, itemIdx: number) {
    const insp = getOrCreateInspeccion(editLineas[lineaIdx]);
    patchLinea(lineaIdx, { inspeccion: { ...insp, items: insp.items.filter((_, ii) => ii !== itemIdx) } });
  }

  function patchLinea(idx: number, patch: Partial<Linea>) {
    setEditLineas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function hayCambiosSinGuardar(): boolean {
    if (!selected) return false;
    if (JSON.stringify(editLineas) !== JSON.stringify(selected.lineas)) return true;
    if (editOtJdeNumero !== (selected.otJdeNumero ?? "")) return true;
    if (editTurno !== (selected.turno ?? "")) return true;
    const fechaOriginal = selected.fecha ? new Date(selected.fecha).toISOString().split("T")[0] : "";
    if (editFecha !== fechaOriginal) return true;
    const tecnicosOriginal = selected.tecnicos.map(t => ({ usuarioId: t.usuarioId ?? "", nombreCompleto: t.nombreCompleto }));
    if (JSON.stringify(editTecnicos) !== JSON.stringify(tecnicosOriginal)) return true;
    return false;
  }

  function cancelarEdicion() {
    if (hayCambiosSinGuardar()) {
      const confirmar = window.confirm(
        "Hay cambios sin guardar. Si cancelás ahora, se van a perder para siempre (síntoma, causa, tareas, observaciones, etc.).\n\n¿Seguro que querés descartarlos?"
      );
      if (!confirmar) return;
    }
    setEditMode(false);
  }

  async function guardarAvance() {
    if (!selected) return;
    if (avanceForm.hhTrabajadas <= 0) { setSaveErr("Ingrese las horas trabajadas"); return; }
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch(`/api/ordenes/${selected._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registroDiario: {
            fecha:            avanceForm.fecha,
            tecnico:          user?.nombre ?? "Técnico",
            usuarioId:        user?.id,
            hhTrabajadas:     avanceForm.hhTrabajadas,
            tareasEjecutadas: avanceForm.tareasEjecutadas,
            observaciones:    avanceForm.observaciones,
            adjuntos:         avanceForm.adjuntos,
          },
          cambio: `Avance del día ${avanceForm.fecha} registrado por ${user?.nombre ?? "Técnico"} — ${avanceForm.hhTrabajadas}HH`,
          usuarioId: user?.id ?? "system",
          nombreUsuario: user?.nombre ?? "Sistema",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setSelected(data.ot);
      setOrdenes(prev => prev.map(o => o._id === data.ot._id ? data.ot : o));
      setShowAvance(false);
      setAvanceForm({ fecha: new Date().toISOString().split("T")[0], hhTrabajadas: 0, tareasEjecutadas: [], observaciones: "", adjuntos: [] });
      setAvanceTareaInput("");
    } catch (e: unknown) { setSaveErr(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  }

  async function guardarEdicionAvance() {
    if (!selected || !editingAvanceId) return;
    if (editAvanceForm.hhTrabajadas <= 0) { setSaveErr("Ingrese las horas trabajadas"); return; }
    const avance = selected.registrosDiarios?.find(r => r._id === editingAvanceId);
    if (!avance) return;
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch(`/api/ordenes/${selected._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registroDiario: {
            id:               avance._id,
            fecha:            editAvanceForm.fecha || avance.fecha,
            tecnico:          avance.tecnico,
            usuarioId:        avance.usuarioId,
            hhTrabajadas:     editAvanceForm.hhTrabajadas,
            tareasEjecutadas: editAvanceForm.tareasEjecutadas,
            observaciones:    editAvanceForm.observaciones,
            adjuntos:         editAvanceForm.adjuntos,
          },
          cambio: `Avance del día ${avance.fecha} editado por ${user?.nombre ?? "Supervisor"}`,
          usuarioId: user?.id ?? "system",
          nombreUsuario: user?.nombre ?? "Sistema",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setSelected(data.ot);
      setOrdenes(prev => prev.map(o => o._id === data.ot._id ? data.ot : o));
      setEditingAvanceId(null);
    } catch (e: unknown) { setSaveErr(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!selected) return;
    const cambios = diffLineas(selected.lineas, editLineas);
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch(`/api/ordenes/${selected._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineas: editLineas,
          cambios,
          otJdeNumero: editOtJdeNumero.trim() || null,
          turno: editTurno || undefined,
          fecha: editFecha || undefined,
          tecnicos: editTecnicos,
          usuarioId: user?.id ?? "sistema",
          nombreUsuario: user?.nombre ?? "Sistema",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setSelected(data.ot);
      setOrdenes((prev) => prev.map((o) => (o._id === data.ot._id ? data.ot : o)));
      setEditMode(false);
    } catch (e: unknown) { setSaveErr(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  }

  async function cambiarEstado(nuevoEstado: EstadoOT, descripcion: string, cerrarDefinitivo = false) {
    if (!selected) return;
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch(`/api/ordenes/${selected._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: nuevoEstado, datosSupervision: supForm,
          ...(cerrarDefinitivo ? { cerradaDefinitiva: true } : {}),
          cambio: descripcion, usuarioId: user?.id ?? "sistema", nombreUsuario: user?.nombre ?? "Sistema",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setSelected(data.ot);
      setOrdenes((prev) => prev.map((o) => (o._id === data.ot._id ? data.ot : o)));
    } catch (e: unknown) { setSaveErr(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  }

  // ─── Lista ───────────────────────────────────────────────────────────────────

  if (!selected) {
    return (
      <div style={S.page}>
        <AppHeader backHref="/ordenes" />
        <div style={S.wrap}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 2 }}>Órdenes de Trabajo</h1>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Borradores · Revisión · Concluidas</p>
            </div>
            {/* Toggle lista / tablero */}
            <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", background: "white" }}>
              {(["lista", "tablero"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  style={{
                    padding: "8px 18px", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: viewMode === m ? "#0f2847" : "white",
                    color: viewMode === m ? "white" : "#64748b",
                  }}
                >
                  {m === "lista" ? "☰ Lista" : "⊞ Tablero"}
                </button>
              ))}
            </div>
          </div>

          {/* Filtros */}
          <div style={{ ...S.card, marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: viewMode === "lista" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={S.label}>Buscar</label>
                  <input value={filtroBuscar} onChange={(e) => setFiltroBuscar(e.target.value)} placeholder="# OT, técnico, TAG…" style={S.input} />
                </div>
                {viewMode === "lista" && (
                  <div>
                    <label style={S.label}>Estado</label>
                    <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={S.select}>
                      <option value="">Todos</option>
                      {COLS_TABLERO.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={S.label}>Área</label>
                  <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)} style={S.select}>
                    <option value="">Todas</option>
                    {(user?.rol === 3 && user.areas?.length > 0
                      ? areas.filter(a => user.areas.includes(a.codigo))
                      : areas
                    ).map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
                  </select>
                </div>
              </div>

              {/* ─── Filtro de período (Capa 1 & 2) — solo en lista ─── */}
              {viewMode === "lista" && (
              <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                <label style={{ ...S.label, display: "block", marginBottom: 6 }}>Período</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {(
                    [
                      { key: "semana",     label: "Esta semana" },
                      { key: "semana_ant", label: "Semana pasada" },
                      { key: "3semanas",   label: "Últimas 3 sem." },
                      { key: "mes",        label: "Último mes" },
                      { key: "todo",       label: "Todo el historial" },
                      { key: "personalizado", label: "Personalizado" },
                    ] as { key: Periodo; label: string }[]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setPeriodo(key);
                        if (key === "semana")      { setFiltroFechaDesde(lunesDeEstaSemana()); setFiltroFechaHasta(""); }
                        else if (key === "semana_ant") { setFiltroFechaDesde(lunesDeSemanaAnterior()); setFiltroFechaHasta(domingoSemanaAnterior()); }
                        else if (key === "3semanas")   { setFiltroFechaDesde(restarDias(21)); setFiltroFechaHasta(""); }
                        else if (key === "mes")         { setFiltroFechaDesde(restarDias(30)); setFiltroFechaHasta(""); }
                        else if (key === "todo")        { setFiltroFechaDesde(""); setFiltroFechaHasta(""); }
                        // personalizado: no cambia las fechas, el usuario las edita abajo
                      }}
                      style={{
                        padding: "4px 12px", fontSize: 12, borderRadius: 20, cursor: "pointer", border: "1px solid",
                        borderColor: periodo === key ? "#2563eb" : "#cbd5e1",
                        background: periodo === key ? "#2563eb" : "#f8fafc",
                        color: periodo === key ? "#fff" : "#475569",
                        fontWeight: periodo === key ? 600 : 400,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Inputs de rango personalizado */}
                {periodo === "personalizado" && (
                  <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
                    <div>
                      <label style={{ ...S.label, marginBottom: 2 }}>Desde</label>
                      <input type="date" value={filtroFechaDesde} onChange={(e) => setFiltroFechaDesde(e.target.value)} style={{ ...S.input, width: 140 }} />
                    </div>
                    <div>
                      <label style={{ ...S.label, marginBottom: 2 }}>Hasta</label>
                      <input type="date" value={filtroFechaHasta} onChange={(e) => setFiltroFechaHasta(e.target.value)} style={{ ...S.input, width: 140 }} />
                    </div>
                  </div>
                )}

                {/* Aviso cuando se está viendo historial completo (Capa 3) */}
                {periodo === "todo" && (
                  <p style={{ fontSize: 11, color: "#f59e0b", marginTop: 6, fontWeight: 500 }}>
                    Mostrando historial completo — incluye OTs concluidas archivadas (&gt;90 días).
                  </p>
                )}
              </div>
              )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ fontSize: 12, color: "#64748b" }}>
              {loading ? "Cargando…" : `${ordenesFiltradas.length} orden(es)`}
              {periodo !== "todo" && !loading && (
                <span style={{ marginLeft: 6, color: "#94a3b8" }}>
                  · {periodo === "semana" ? "esta semana" : periodo === "semana_ant" ? "semana pasada" : periodo === "3semanas" ? "últimas 3 semanas" : periodo === "mes" ? "último mes" : "rango personalizado"}
                </span>
              )}
            </p>
            <button onClick={() => loadOrdenes()} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}>↻ Actualizar</button>
          </div>

          {loadError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 12.5, padding: "8px 12px", borderRadius: 6, marginBottom: 10 }}>
              ⚠ {loadError}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: 48, color: "#94a3b8", fontSize: 14 }}>Cargando…</div>
          ) : viewMode === "lista" ? (
            /* ── Vista Lista ── */
            ordenesFiltradas.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
                <p style={{ color: "#94a3b8", fontSize: 14 }}>No hay órdenes con esos filtros.</p>
              </div>
            ) : (
              ordenesFiltradas.map((ot) => {
                const color = ESTADO_COLOR[ot.estado] ?? "#64748b";
                // Indicador de semana anterior: OTs cuya fecha cae antes del lunes de la semana actual (hora Bolivia UTC-4)
                const lunesEstaSemanaBol = (() => {
                  const d = new Date();
                  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
                  d.setUTCHours(4, 0, 0, 0); // medianoche Bolivia = 4 AM UTC
                  return d;
                })();
                const esSemanaAnterior = new Date(ot.fecha) < lunesEstaSemanaBol;
                return (
                  <div
                    key={ot._id}
                    onClick={() => setSelected(ot)}
                    style={{ ...S.card, borderLeft: `4px solid ${color}`, cursor: "pointer" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.09)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={{ fontWeight: 800, fontSize: 15, color: "#0f2847" }}>{ot.otJdeNumero ? `OT ${ot.otJdeNumero}` : `#${ot.numeroOT}`}</span>
                          <span style={S.badge(color)}>{ESTADO_LABEL[ot.estado]}</span>
                          {ot.esRecurrente && (
                            <span style={{ ...S.badge("#7c3aed"), fontSize: 10 }} title="Ya se programó en más de una semana">🔁 Recurrente</span>
                          )}
                          {esSemanaAnterior && (
                            <span style={{ ...S.badge("#92400e"), background: "#fef3c7", color: "#92400e", fontSize: 10, fontWeight: 700, letterSpacing: "0.03em" }}>
                              ⏳ Sem. ant.
                            </span>
                          )}
                          {ot.lineas.map((l, i) => <span key={i} style={S.badge(tipoColor(l.tipoOT))}>{tipoOtDisplay(l.tipoOT).texto}</span>)}
                        </div>
                        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>
                          {new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })} · {ot.turno} · {areaNombre(ot.areaCodigo)}
                        </p>
                        <p style={{ fontSize: 12, color: "#475569" }}>{ot.tecnicos.map((t) => t.nombreCompleto).join(", ")}</p>
                        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ot.lineas.map((l) => l.tag).join(" · ")}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{ot.lineas.length} equipo(s)</span>
                        <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>Ver →</span>
                      </div>
                    </div>
                    {esAdmin && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, paddingTop: 8, borderTop: "1px solid #fee2e2" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(null);
                            setDeletingId(ot._id);
                          }}
                          style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, background: "none", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer", padding: "3px 10px" }}
                        >
                          🗑 Eliminar OT
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            /* ── Vista Tablero ── */
            <div style={{ overflowX: "auto", paddingBottom: 12 }}>
              <div style={{ display: "flex", gap: 12, minWidth: 900 }}>
                {COLS_TABLERO.map((col) => {
                  const colOTs = ordenesFiltradas.filter((o) => o.estado === col.key);
                  return (
                    <div key={col.key} style={{ flex: "0 0 200px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Cabecera columna */}
                      <div style={{
                        background: col.color + "15", borderRadius: 8, padding: "8px 12px",
                        border: `1px solid ${col.color}30`,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: col.color }}>{col.label}</span>
                        <span style={{
                          background: col.color, color: "white", borderRadius: "50%",
                          width: 20, height: 20, display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: 11, fontWeight: 800,
                        }}>{colOTs.length}</span>
                      </div>

                      {colOTs.length === 0 && (
                        <div style={{ padding: "16px 8px", textAlign: "center", color: "#cbd5e1", fontSize: 12, borderRadius: 8, border: "1px dashed #e2e8f0", background: "white" }}>
                          Vacío
                        </div>
                      )}

                      {colOTs.map((ot) => (
                        <div
                          key={ot._id}
                          style={{ background: "white", borderRadius: 10, border: `1px solid ${col.color}30`, padding: "10px 12px", borderTop: `3px solid ${col.color}` }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontWeight: 800, fontSize: 13, color: "#0f2847" }}>{ot.otJdeNumero ? `OT ${ot.otJdeNumero}` : `#${ot.numeroOT}`}</span>
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>{new Date(ot.fecha).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}</span>
                          </div>
                          {/* Badge origen: plan vs reactiva */}
                          <div style={{ display: "flex", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
                            {ot.origenPlan ? (
                              <span style={{ fontSize: 9, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.04em" }}>
                                📋 PLAN · JDE {ot.otJdeNumero}
                              </span>
                            ) : (
                              <span style={{ fontSize: 9, fontWeight: 700, background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.04em" }}>
                                ⚡ REACTIVA
                              </span>
                            )}
                            {ot.lineas.map((l, i) => (
                              <span key={i} style={{ fontSize: 9, fontWeight: 700, background: tipoColor(l.tipoOT) + "20", color: tipoColor(l.tipoOT), borderRadius: 4, padding: "1px 5px" }}>
                                {tipoOtDisplay(l.tipoOT).texto}
                              </span>
                            ))}
                          </div>
                          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 3 }}>{areaNombre(ot.areaCodigo)}</p>
                          <p style={{ fontSize: 11, color: "#475569", marginBottom: 3, lineHeight: 1.3 }}>
                            {ot.tecnicos.map((t) => t.nombreCompleto.split(" ")[0]).join(", ")}
                          </p>
                          <p style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>
                            {ot.lineas.map((l) => l.tag).join(", ")}
                          </p>

                          {/* Acciones rápidas */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button
                              onClick={() => setSelected(ot)}
                              style={{ width: "100%", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                            >
                              Ver detalle →
                            </button>
                            {ot.estado === "en_proceso" && esSup && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const res = await fetch(`/api/ordenes/${ot._id}`, {
                                    method: "PATCH", headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ estado: "pendiente_revision", cambio: "Enviada a revisión por " + (user?.nombre ?? "supervisor"), usuarioId: user?.id ?? "sistema", nombreUsuario: user?.nombre ?? "Supervisor" }),
                                  });
                                  const data = await res.json();
                                  if (res.ok) setOrdenes((prev) => prev.map((o) => o._id === data.ot._id ? data.ot : o));
                                }}
                                style={{ width: "100%", background: "#fef3c7", color: "#92400e", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >
                                📋 Enviar a revisión
                              </button>
                            )}
                            {ot.estado === "pendiente_revision" && (
                              <>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const res = await fetch(`/api/ordenes/${ot._id}`, {
                                      method: "PATCH", headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ estado: "revisado", cambio: "OT aprobada por " + (user?.nombre ?? "supervisor"), usuarioId: user?.id ?? "sistema", nombreUsuario: user?.nombre ?? "Supervisor" }),
                                    });
                                    const data = await res.json();
                                    if (res.ok) setOrdenes((prev) => prev.map((o) => o._id === data.ot._id ? data.ot : o));
                                  }}
                                  style={{ width: "100%", background: "#dcfce7", color: "#15803d", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                                >
                                  ✓ Aprobar
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const res = await fetch(`/api/ordenes/${ot._id}`, {
                                      method: "PATCH", headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ estado: "solicitar_correccion", cambio: "Supervisor solicitó corrección", usuarioId: user?.id ?? "sistema", nombreUsuario: user?.nombre ?? "Supervisor" }),
                                    });
                                    const data = await res.json();
                                    if (res.ok) setOrdenes((prev) => prev.map((o) => o._id === data.ot._id ? data.ot : o));
                                  }}
                                  style={{ width: "100%", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                                >
                                  ✗ Corrección
                                </button>
                              </>
                            )}
                            {ot.estado === "revisado" && esSup && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const res = await fetch(`/api/ordenes/${ot._id}`, {
                                    method: "PATCH", headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ estado: "concluido", cambio: "OT concluida y cerrada", usuarioId: user?.id ?? "sistema", nombreUsuario: user?.nombre ?? "Supervisor" }),
                                  });
                                  const data = await res.json();
                                  if (res.ok) setOrdenes((prev) => prev.map((o) => o._id === data.ot._id ? data.ot : o));
                                }}
                                style={{ width: "100%", background: "#dcfce7", color: "#15803d", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >
                                ✓ Concluir
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Detalle ─────────────────────────────────────────────────────────────────

  const ot = selected;
  const estadoColor = ESTADO_COLOR[ot.estado] ?? "#64748b";
  const isConcluido = ot.estado === "concluido";

  // Técnico envía a revisión desde borrador/corrección; supervisor/admin en cualquier estado activo
  const enEstadoTecnico = ot.estado === "borrador" || ot.estado === "solicitar_correccion";
  // Técnico también puede editar la OT y sus avances mientras está "en proceso" (facilita
  // corregir errores durante la semana); una vez enviada a revisión ya no puede tocarla.
  const puedeEditarTecnico = enEstadoTecnico || ot.estado === "en_proceso";

  // Técnico solo puede editar OTs donde él está asignado (por id/nombre en el roster,
  // o porque ya registró un avance propio — ver esTecnicoDeLaOt)
  const esOtPropia = esTecnico && esTecnicoDeLaOt(ot, user);

  const canEdit = !isConcluido && (esAdmin || (esTecnico && puedeEditarTecnico && esOtPropia) || (esSup && !esTecnico));

  // Solo técnico (o admin) puede enviar a revisión desde borrador/corrección
  // Para OTs del plan (OPEPLANT): solo si su semana ya terminó, o si es la semana en
  // curso, solo el domingo (cierre semanal) — o admin. Ver src/lib/turno.ts.
  const now = new Date();
  const bloqueoCierreSemanal = ot.origenPlan && !estaEnVentanaCierreSemanal({
    semanaOT: getWeekNumber(new Date(ot.fecha)), anioOT: new Date(ot.fecha).getFullYear(),
    semanaActual: getWeekNumber(now), anioActual: now.getFullYear(),
  }) && !esAdmin;
  const canSendToReview = enEstadoTecnico && (esAdmin || (esTecnico && esOtPropia)) && !bloqueoCierreSemanal;

  // Formulario de supervisión: solo supervisores/admins, cuando la OT está en pendiente_revision
  const showSupForm = esSup && ot.estado === "pendiente_revision";

  // Botones de aprobar/rechazar: supervisores/admins en pendiente_revision
  const canRevisar = esSup && ot.estado === "pendiente_revision";

  // Botón concluir: supervisores/admins en revisado
  const canConcluir = esSup && ot.estado === "revisado";

  const showSupReadonly = !showSupForm && !isConcluido && !!(ot.datosSupervision?.comentariosSupervisor || ot.datosSupervision?.requierePlanificacion);
  const hasReactivas = ot.lineas.some((l) => l.tipoOT === "CMP" || l.tipoOT === "CMR");

  return (
    <>
    <div style={S.page}>
      <AppHeader backHref="/ordenes" />
      <div style={S.wrap}>

        {/* Cabecera */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => setSelected(null)} style={{ ...S.btnGhost, padding: "7px 14px" }}>← Lista</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847" }}>
                {ot.otJdeNumero ? `OT ${ot.otJdeNumero}` : `OT #${ot.numeroOT}`}
              </h1>
              <span style={S.badge(estadoColor)}>{ESTADO_LABEL[ot.estado]}</span>
              {ot.origenPlan ? (
                <span style={{ ...S.badge("#1d4ed8"), fontSize: 11 }}>
                  📋 Plan Semanal{ot.otJdeDia ? ` · ${ot.otJdeDia}` : ""}
                </span>
              ) : (
                <span style={{ ...S.badge("#dc2626"), fontSize: 11 }}>⚡ Reactiva</span>
              )}
              {ot.esRecurrente && (
                <span style={{ ...S.badge("#7c3aed"), fontSize: 11 }} title="Ya se programó en más de una semana: se reabre sola cuando el plan la vuelve a programar">
                  🔁 OT recurrente (largo aliento)
                </span>
              )}
              {(() => {
                const lunes = new Date();
                lunes.setUTCDate(lunes.getUTCDate() - ((lunes.getUTCDay() + 6) % 7));
                lunes.setUTCHours(4, 0, 0, 0);
                return new Date(ot.fecha) < lunes ? (
                  <span style={{ ...S.badge("#92400e"), background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 700 }}>⏳ Semana anterior</span>
                ) : null;
              })()}
              {editMode && <span style={{ ...S.badge("#f59e0b"), fontSize: 11 }}>✏ Modo edición</span>}
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8" }}>{new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })} · {ot.turno}</p>
          </div>
          {canEdit && !editMode && (
            <button onClick={enterEditMode} style={{ ...S.btnAmber, padding: "8px 16px", fontSize: 13 }}>
              ✏ Editar OT
            </button>
          )}
          {editMode && (
            <button onClick={cancelarEdicion} style={{ ...S.btnGhost, padding: "8px 16px", fontSize: 13 }}>
              Cancelar edición
            </button>
          )}
        </div>

        {/* Encabezado OT */}
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Encabezado</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
            <div>
              <span style={S.label}>Fecha de ejecución</span>
              {editMode ? (
                <input
                  type="date"
                  value={editFecha}
                  onChange={e => setEditFecha(e.target.value)}
                  style={{ marginTop: 4, padding: "6px 10px", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 14, background: "#fffbeb", width: "100%" }}
                />
              ) : (
                <p style={{ fontSize: 14, color: "#1e293b" }}>{new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })}</p>
              )}
            </div>
            <div>
              <span style={S.label}>Área</span>
              <p style={{ fontSize: 14, color: "#1e293b" }}>{ot.areaCodigo} — {areaNombre(ot.areaCodigo)}</p>
            </div>
            <div>
              <span style={S.label}>Turno</span>
              {editMode ? (
                <select
                  value={editTurno}
                  onChange={e => setEditTurno(e.target.value)}
                  style={{ marginTop: 4, padding: "6px 10px", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 14, background: "#fffbeb", width: "100%" }}
                >
                  {["Diurno", "Nocturno", "Parada de Planta", "Planta", "Otro"].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <p style={{ fontSize: 14, color: "#1e293b" }}>{ot.turno}</p>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={S.label}>Técnico(s)</span>
              {editMode ? (
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {editTecnicos.map((t, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#dbeafe", color: "#1d4ed8", borderRadius: 6, padding: "3px 10px", fontSize: 13, fontWeight: 600 }}>
                        {t.nombreCompleto}
                        <button type="button" onClick={() => setEditTecnicos(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#1d4ed8", fontWeight: 800, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    ))}
                  </div>
                  <select
                    defaultValue=""
                    onChange={e => {
                      const opt = e.target.options[e.target.selectedIndex];
                      if (!opt.value) return;
                      const ya = editTecnicos.some(t => t.usuarioId === opt.value || t.nombreCompleto === opt.text);
                      if (!ya) setEditTecnicos(prev => [...prev, { usuarioId: opt.value, nombreCompleto: opt.text }]);
                      e.target.value = "";
                    }}
                    style={{ padding: "6px 10px", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 13, background: "#fffbeb", maxWidth: 300 }}
                  >
                    <option value="">+ Agregar técnico…</option>
                    {usuariosDisponibles.filter(u => !editTecnicos.some(t => t.usuarioId === u._id)).map(u => (
                      <option key={u._id} value={u._id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p style={{ fontSize: 14, color: "#1e293b" }}>{ot.tecnicos.map((t) => t.nombreCompleto).join(", ")}</p>
              )}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={S.label}>N° OT JDE / OPEPLANT</span>
              {editMode ? (
                <input
                  type="text"
                  value={editOtJdeNumero}
                  onChange={e => setEditOtJdeNumero(e.target.value)}
                  placeholder="ej. 892867"
                  style={{ marginTop: 4, padding: "6px 10px", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 14, fontFamily: "monospace", width: 180, background: "#fffbeb" }}
                />
              ) : (
                <p style={{ fontSize: 14, color: ot.otJdeNumero ? "#1e293b" : "#94a3b8", fontFamily: ot.otJdeNumero ? "monospace" : "inherit", fontWeight: ot.otJdeNumero ? 700 : 400 }}>
                  {ot.otJdeNumero ?? "Sin vincular"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Equipos — modo lectura */}
        {!editMode && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>
              Equipos intervenidos ({ot.lineas.length})
            </div>
            {ot.lineas.map((l, i) => (
              <div key={i} style={{ borderLeft: `3px solid ${l.tipoOT ? tipoColor(l.tipoOT) : "#e2e8f0"}`, paddingLeft: 12, marginBottom: i < ot.lineas.length - 1 ? 14 : 0, paddingBottom: i < ot.lineas.length - 1 ? 14 : 0, borderBottom: i < ot.lineas.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontWeight: 800, fontSize: 14 }}>{l.tag}</span>
                  <span style={S.badge(tipoColor(l.tipoOT))}>{tipoOtDisplay(l.tipoOT).texto}</span>
                </div>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{l.descripcionEquipo}</p>
                {l.sintoma && <p style={{ fontSize: 12, color: "#475569" }}>Síntoma: {l.sintoma}</p>}
                {l.causaProbable && <p style={{ fontSize: 12, color: "#475569" }}>Causa: {l.causaProbable}</p>}
                {l.resolucionAplicada && <p style={{ fontSize: 12, color: "#475569" }}>Resolución: {l.resolucionAplicada}</p>}
                {l.descripcionTrabajo && <p style={{ fontSize: 12, color: "#475569" }}>{l.descripcionTrabajo}</p>}
                {l.tareasEjecutadas && l.tareasEjecutadas.length > 0 && (
                  <ul style={{ margin: "4px 0", paddingLeft: 16 }}>{l.tareasEjecutadas.map((t, ti) => <li key={ti} style={{ fontSize: 12, color: "#64748b" }}>{t}</li>)}</ul>
                )}
                {(l.tiempoEstimadoHrs || l.tiempoRealHrs || l.estadoFinal) && (
                  <div style={{ display: "flex", gap: 12, marginTop: 3, alignItems: "center" }}>
                    {l.tiempoEstimadoHrs && <span style={{ fontSize: 12, color: "#94a3b8" }}>Est: {l.tiempoEstimadoHrs}HH</span>}
                    {l.tiempoRealHrs && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>Real: {l.tiempoRealHrs}HH</span>}
                    {l.estadoFinal && (() => {
                      const eo = ESTADO_FINAL_OPTIONS.find(o => o.value === l.estadoFinal);
                      return eo ? <span style={{ fontSize: 10, fontWeight: 700, color: eo.color, background: eo.color + "15", borderRadius: 5, padding: "2px 7px" }}>{eo.label}</span> : null;
                    })()}
                  </div>
                )}
                {l.observaciones && <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 2 }}>{l.observaciones}</p>}

                {l.inspeccion && (["PMP", "PMT", "PTJ"].includes(l.tipoOT)) && (
                  <div style={{ marginTop: 8, background: "#f0fdff", border: "1px solid #a5f3fc", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, fontSize: 11, color: "#0891b2", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                      Inspección: {l.inspeccion.checklistNombre}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {l.inspeccion.items.map((it, ii) => (
                        <div key={ii} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                          <span style={{ color: it.ok ? "#0891b2" : "#94a3b8", fontWeight: 800, flexShrink: 0 }}>{it.ok ? "✓" : "○"}</span>
                          <span style={{ color: it.ok ? "#0f172a" : "#64748b", textDecoration: it.ok ? "none" : "none", flex: 1 }}>
                            {it.descripcion}
                            {it.obs && <span style={{ color: "#94a3b8", fontStyle: "italic" }}> — {it.obs}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Adjuntos existentes */}
                {(l.adjuntos ?? []).length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(l.adjuntos ?? []).map((adj, ai) => (
                      <div key={ai} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                        {adj.tipo === "foto"
                          ? <img src={adj.dataUrl} alt={adj.nombre} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />
                          : <span style={{ fontSize: 18 }}>📄</span>
                        }
                        <div>
                          <div style={{ fontWeight: 600, color: "#374151" }}>{adj.nombre}</div>
                          {adj.comentario && <div style={{ color: "#94a3b8" }}>{adj.comentario}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Botón agregar evidencia — supervisores y admins en cualquier estado */}
                {(esSup || esAdmin) && !isConcluido && (
                  <button
                    onClick={() => {
                      setEvidenciaModal({ lineaTag: l.tag, lineaTipoOT: l.tipoOT });
                      setEvidenciaComentario("");
                      setEvidenciaPreview(null);
                    }}
                    style={{ marginTop: 8, background: "none", border: "1px dashed #94a3b8", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    📷 Agregar evidencia
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Equipos — modo edición con trazabilidad */}
        {editMode && (
          <div style={{ ...S.card, border: "2px solid #f59e0b", background: "#fffbeb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>✏ Edición con Trazabilidad</div>
                <p style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>Cada cambio queda registrado en el historial con fecha y autor.</p>
              </div>
            </div>
            {editLineas.map((l, i) => {
              const hasChecklist = ["PMP", "PMT", "PTJ"].includes(l.tipoOT);
              const isCorrectivo = ["CMP", "CMR"].includes(l.tipoOT);
              const insp = l.inspeccion ?? (hasChecklist ? { checklistId: "", checklistNombre: "Checklist supervisión", items: [] } : null);
              return (
                <div key={i} style={{ borderLeft: `3px solid ${l.tipoOT ? tipoColor(l.tipoOT) : "#e2e8f0"}`, paddingLeft: 12, marginBottom: i < editLineas.length - 1 ? 20 : 0, paddingBottom: i < editLineas.length - 1 ? 20 : 0, borderBottom: i < editLineas.length - 1 ? "1px solid #fde68a" : "none" }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{l.tag}</span>
                    <span style={S.badge(tipoColor(l.tipoOT))}>{tipoOtDisplay(l.tipoOT).texto}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{l.descripcionEquipo}</span>
                  </div>

                  {/* Tiempo estimado + real */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ ...S.label, marginBottom: 3 }}>HH Estimadas</label>
                      <input
                        type="number" min="0" step="0.5"
                        value={l.tiempoEstimadoHrs ?? ""}
                        onChange={(e) => patchLinea(i, { tiempoEstimadoHrs: e.target.value ? Number(e.target.value) : undefined })}
                        style={S.inputSm}
                      />
                      {ot.lineas[i].tiempoEstimadoHrs !== undefined && (
                        <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>Orig: {ot.lineas[i].tiempoEstimadoHrs}HH</p>
                      )}
                    </div>
                    <div>
                      <label style={{ ...S.label, marginBottom: 3 }}>HH Trabajadas <span style={{ fontWeight: 400, textTransform: "none" as const }}>(personas × horas)</span></label>
                      <input
                        type="number" min="0" step="0.5"
                        value={l.tiempoRealHrs ?? ""}
                        onChange={(e) => patchLinea(i, { tiempoRealHrs: e.target.value ? Number(e.target.value) : undefined })}
                        style={S.inputSm}
                      />
                      {ot.lineas[i].tiempoRealHrs !== undefined && (
                        <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>Orig: {ot.lineas[i].tiempoRealHrs}HH</p>
                      )}
                    </div>
                  </div>

                  {/* Síntoma / Causa / Resolución — CMP y CMR (correctivos) */}
                  {isCorrectivo && (
                    <>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ ...S.label, marginBottom: 3 }}>Síntoma</label>
                        <textarea value={l.sintoma ?? ""} onChange={(e) => patchLinea(i, { sintoma: e.target.value })} style={S.textareaSm} />
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ ...S.label, marginBottom: 3 }}>Causa probable</label>
                        <textarea value={l.causaProbable ?? ""} onChange={(e) => patchLinea(i, { causaProbable: e.target.value })} style={S.textareaSm} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ ...S.label, marginBottom: 3 }}>Resolución aplicada</label>
                        <textarea value={l.resolucionAplicada ?? ""} onChange={(e) => patchLinea(i, { resolucionAplicada: e.target.value })} style={S.textareaSm} />
                      </div>
                    </>
                  )}

                  {/* Checklist — CMP, PMP, PTJ */}
                  {hasChecklist && insp && (
                    <div style={{ marginBottom: 12, background: "#f0fdff", border: "1px solid #a5f3fc", borderRadius: 10, padding: "12px 14px" }}>
                      <label style={{ ...S.label, marginBottom: 8, color: "#0891b2" }}>
                        Checklist — {insp.checklistNombre || "sin nombre"}
                      </label>

                      {/* Ítems existentes */}
                      {insp.items.length === 0 && (
                        <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 8 }}>
                          Sin ítems aún. Agregue uno abajo.
                        </p>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                        {insp.items.map((it, ii) => (
                          <div key={ii} style={{ background: "white", borderRadius: 8, border: "1px solid #e0f7fa", padding: "8px 10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                              <input
                                type="checkbox"
                                checked={it.ok}
                                onChange={() => toggleItemChecklist(i, ii)}
                                style={{ width: 15, height: 15, accentColor: "#0891b2", cursor: "pointer", flexShrink: 0 }}
                              />
                              <span style={{ flex: 1, fontSize: 13, color: it.ok ? "#0891b2" : "#1e293b", fontWeight: it.ok ? 600 : 400, textDecoration: it.ok ? "line-through" : "none" }}>
                                {ii + 1}. {it.descripcion}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeItemChecklist(i, ii)}
                                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 13, flexShrink: 0 }}
                              >✕</button>
                            </div>
                            <input
                              type="text"
                              value={it.obs}
                              onChange={(e) => editObsChecklist(i, ii, e.target.value)}
                              placeholder="Comentario del supervisor (opcional)"
                              style={{ ...S.input, fontSize: 12, padding: "5px 9px", background: "#f8fafc" }}
                            />
                          </div>
                        ))}
                      </div>

                      {/* Agregar ítem nuevo */}
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={itemCheckInputs[i] ?? ""}
                          onChange={(e) => setItemCheckInputs((ts) => ts.map((t, ii) => (ii === i ? e.target.value : t)))}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItemChecklist(i); } }}
                          placeholder="Nuevo ítem del checklist…"
                          style={{ ...S.input, fontSize: 12, padding: "6px 10px" }}
                        />
                        <button
                          type="button"
                          onClick={() => addItemChecklist(i)}
                          style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" as const, borderColor: "#a5f3fc", color: "#0891b2" }}
                        >+ Ítem</button>
                      </div>
                    </div>
                  )}

                  {/* Tareas — todos los tipos de OT (PMP, PMT, PDM, PTJ, CMP, CMR) */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ ...S.label, marginBottom: 6 }}>Tareas</label>
                    {(l.tareasEjecutadas ?? []).map((t, ti) => (
                      <div key={ti} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ flex: 1, fontSize: 13, color: "#1e293b", background: "#f8fafc", borderRadius: 6, padding: "5px 9px" }}>{t}</span>
                        <button type="button" onClick={() => removeTareaLinea(i, ti)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>✕</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <input
                        value={tareaInputs[i] ?? ""}
                        onChange={(e) => setTareaInputs((ts) => ts.map((t, ii) => (ii === i ? e.target.value : t)))}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTareaLinea(i); } }}
                        placeholder="Nueva tarea…"
                        style={{ ...S.input, fontSize: 13, padding: "6px 10px" }}
                      />
                      <button type="button" onClick={() => addTareaLinea(i)} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" as const }}>+ Tarea</button>
                    </div>
                  </div>

                  {/* Estado final del equipo — siempre */}
                  <div>
                    <label style={{ ...S.label, marginBottom: 3 }}>Estado final del equipo</label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                      {ESTADO_FINAL_OPTIONS.map(o => {
                        const active = l.estadoFinal === o.value;
                        return (
                          <button key={o.value} type="button" onClick={() => patchLinea(i, { estadoFinal: o.value })}
                            style={{ padding: "6px 11px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: active ? `2px solid ${o.color}` : "1px solid #e2e8f0", background: active ? o.color + "15" : "white", color: active ? o.color : "#64748b", fontWeight: active ? 800 : 400 }}>
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
            {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>⚠ {saveErr}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={cancelarEdicion} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }}>Cancelar</button>
              <button onClick={saveEdit} disabled={saving} style={{ ...S.btnAmber, padding: "8px 18px", fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Guardando…" : "Guardar cambios con trazabilidad"}
              </button>
            </div>
          </div>
        )}

        {/* Supervisión editable */}
        {showSupForm && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 14 }}>Datos de Supervisión</div>

            {/* Preventivos: Genera OT de Hallazgo */}
            {!hasReactivas && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>¿Genera OT de Hallazgo?</label>
                  <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                    {([true, false] as const).map((val) => (
                      <label key={String(val)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "#374151" }}>
                        <input
                          type="radio"
                          name="generaOtHallazgo"
                          checked={supForm.generaOtHallazgo === val}
                          onChange={() => patchSup({ generaOtHallazgo: val })}
                          style={{ accentColor: "#2563eb" }}
                        />
                        {val ? "Sí" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
                {supForm.generaOtHallazgo && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={S.label}>Nueva OT Generada</label>
                    <input
                      value={supForm.otGenerada}
                      onChange={(e) => patchSup({ otGenerada: e.target.value })}
                      placeholder="Número de OT generada"
                      style={S.input}
                    />
                  </div>
                )}
              </>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={supForm.requierePlanificacion} onChange={(e) => patchSup({ requierePlanificacion: e.target.checked })} style={{ width: 16, height: 16, accentColor: "#2563eb" }} />
                <span style={{ fontSize: 13, color: "#374151" }}>Requiere WR</span>
              </label>
            </div>

            {/* Comentarios del supervisor — múltiples */}
            <div>
              <label style={S.label}>Comentarios del supervisor</label>
              {/* Lista de comentarios ya agregados */}
              {supForm.comentariosSupervisor && supForm.comentariosSupervisor.split("\n").filter(Boolean).map((c, ci) => (
                <div key={ci} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 13, color: "#1e293b", background: "#f8fafc", borderRadius: 6, padding: "6px 10px", border: "1px solid #e2e8f0", lineHeight: 1.5 }}>{c}</span>
                  <button type="button"
                    onClick={() => {
                      const lines = supForm.comentariosSupervisor.split("\n").filter(Boolean);
                      patchSup({ comentariosSupervisor: lines.filter((_, j) => j !== ci).join("\n") });
                    }}
                    style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 15, paddingTop: 4 }}>✕</button>
                </div>
              ))}
              {/* Input + Agregar */}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={supComentarioInput}
                  onChange={e => setSupComentarioInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const txt = supComentarioInput.trim();
                      if (!txt) return;
                      const prev = supForm.comentariosSupervisor;
                      patchSup({ comentariosSupervisor: prev ? prev + "\n" + txt : txt });
                      setSupComentarioInput("");
                    }
                  }}
                  placeholder="Agregar comentario — Enter para confirmar"
                  style={{ ...S.input, fontSize: 13, flex: 1 }}
                />
                <button type="button"
                  onClick={() => {
                    const txt = supComentarioInput.trim();
                    if (!txt) return;
                    const prev = supForm.comentariosSupervisor;
                    patchSup({ comentariosSupervisor: prev ? prev + "\n" + txt : txt });
                    setSupComentarioInput("");
                  }}
                  style={{ background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const }}>
                  + Agregar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Supervisión solo lectura */}
        {showSupReadonly && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Datos de Supervisión</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ot.datosSupervision.requierePlanificacion && (
                <div><span style={S.label}>Requiere WR</span><p style={{ fontSize: 13 }}>Sí</p></div>
              )}
              {ot.datosSupervision.comentariosSupervisor && (
                <div>
                  <span style={S.label}>Comentarios del Supervisor</span>
                  {ot.datosSupervision.comentariosSupervisor.split("\n").filter(Boolean).map((c, ci) => (
                    <p key={ci} style={{ fontSize: 13, lineHeight: 1.6, padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>{c}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Acciones de estado */}
        {!isConcluido && !editMode && (canSendToReview || canRevisar || canConcluir) && (
          <div style={{ ...S.card, background: "#f8fafc" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 10 }}>Acciones</div>
            {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>⚠ {saveErr}</p>}
            {bloqueoCierreSemanal && enEstadoTecnico && (
              <p style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
                ⏳ Esta OT es del plan semanal. El envío a revisión se habilita el <strong>domingo</strong> al finalizar la semana.
              </p>
            )}
            {canConcluir && ot.origenPlan && ot.otJdeNumero && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#0f2847", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={cierreDefinitivo} onChange={e => setCierreDefinitivo(e.target.checked)} style={{ marginTop: 2 }} />
                <span>
                  Esta OT no va a continuar (cierre definitivo).<br />
                  <span style={{ color: "#64748b" }}>
                    {ot.esRecurrente
                      ? "Esta OT ya se detectó como recurrente (apareció en más de una semana): déjalo sin marcar para que se reabra sola cuando el plan la vuelva a programar."
                      : "Si es una OT recurrente (aparece semana tras semana), déjalo sin marcar para que se reabra sola cuando el plan la vuelva a programar."}
                  </span>
                </span>
              </label>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canSendToReview && (
                <button onClick={() => cambiarEstado("pendiente_revision", "OT enviada a revisión por " + (user?.nombre ?? "técnico"))} disabled={saving} style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Guardando…" : "Enviar a revisión ↑"}
                </button>
              )}
              {canRevisar && (
                <>
                  <button onClick={() => cambiarEstado("solicitar_correccion", "Supervisor solicitó corrección")} disabled={saving} style={{ ...S.btnRed, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Guardando…" : "Solicitar corrección"}
                  </button>
                  <button onClick={() => cambiarEstado("revisado", "OT aprobada por " + (user?.nombre ?? "supervisor"))} disabled={saving} style={{ ...S.btnGreen, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Guardando…" : "Aprobar OT ✓"}
                  </button>
                </>
              )}
              {canConcluir && (
                <button onClick={() => cambiarEstado("concluido", "OT concluida y cerrada", cierreDefinitivo)} disabled={saving} style={{ ...S.btnGreen, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Guardando…" : "Concluir OT ✓"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Reabrir OT — solo admin, en estados que bloquean al técnico */}
        {esAdmin && ["revisado", "pendiente_revision", "concluido", "solicitar_correccion"].includes(ot.estado) && (
          <div style={{ ...S.card, background: "#fff7ed", border: "1px solid #fed7aa" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showReabrir ? 12 : 0 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#9a3412" }}>🔓 Reabrir OT</span>
                <span style={{ fontSize: 12, color: "#c2410c", marginLeft: 8 }}>Solo administrador</span>
              </div>
              {!showReabrir && (
                <button onClick={() => { setShowReabrir(true); setReabrirRazon(""); }}
                  style={{ background: "#ea580c", color: "white", border: "none", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Reabrir OT
                </button>
              )}
            </div>
            {showReabrir && (
              <div>
                <p style={{ fontSize: 12, color: "#7c2d12", marginBottom: 10 }}>
                  Esto devolverá la OT a estado <strong>En proceso</strong> para que el técnico pueda continuar registrando avances. Quedará registrado en el historial.
                </p>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ ...S.label, color: "#9a3412" }}>Razón (obligatorio)</label>
                  <input
                    value={reabrirRazon}
                    onChange={e => setReabrirRazon(e.target.value)}
                    placeholder="Ej: OT recurrente cerrada antes de completar la semana"
                    style={{ ...S.input, borderColor: "#fed7aa" }}
                    autoFocus
                  />
                </div>
                {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>⚠ {saveErr}</p>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => { setShowReabrir(false); setReabrirRazon(""); setSaveErr(""); }}
                    style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }}>Cancelar</button>
                  <button
                    disabled={!reabrirRazon.trim() || savingReabrir}
                    onClick={async () => {
                      if (!selected || !reabrirRazon.trim()) return;
                      setSavingReabrir(true); setSaveErr("");
                      try {
                        const res = await fetch(`/api/ordenes/${selected._id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            estado: "en_proceso",
                            cambio: `OT reabierta por admin ${user?.nombre ?? ""} — ${reabrirRazon.trim()}`,
                            usuarioId: user?.id ?? "sistema",
                            nombreUsuario: user?.nombre ?? "Admin",
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error ?? "Error al reabrir");
                        setSelected(data.ot);
                        setOrdenes(prev => prev.map(o => o._id === data.ot._id ? data.ot : o));
                        setShowReabrir(false);
                        setReabrirRazon("");
                      } catch (e: unknown) { setSaveErr(e instanceof Error ? e.message : "Error"); }
                      finally { setSavingReabrir(false); }
                    }}
                    style={{ background: !reabrirRazon.trim() || savingReabrir ? "#d1d5db" : "#ea580c", color: "white", border: "none", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: !reabrirRazon.trim() || savingReabrir ? "not-allowed" : "pointer" }}>
                    {savingReabrir ? "Reabriendo…" : "Confirmar reapertura"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {(isConcluido || ot.estado === "revisado" || ot.estado === "en_proceso" || (esSup && ot.estado === "pendiente_revision")) && (
          <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ fontSize: 13, color: "#15803d", fontWeight: 600, margin: 0 }}>
              {isConcluido ? "OT concluida — solo lectura." : "OT revisada — lista para concluir."}
            </p>
            <button
              onClick={async () => {
                // Para OTs de plan con número JDE, fusionar datos de todos los registros
                // del mismo otJdeNumero+programacionSemanalId antes de generar el PDF
                // Recargar OT actual fresca para garantizar que adjuntos estén completos
                let otBase: typeof ot = ot;
                try {
                  const fresca: OTDoc = await fetch(`/api/ordenes/${ot._id}`).then(r => r.json());
                  if (fresca?._id) otBase = fresca;
                } catch { /* usa ot cargado */ }

                let otParaPDF: typeof ot = otBase;
                if (otBase.origenPlan && otBase.otJdeNumero) {
                  try {
                    const hermanos: OTDoc[] = await fetch(
                      `/api/ordenes?otJdeNumero=${encodeURIComponent(otBase.otJdeNumero)}&limit=20`
                    ).then(r => r.json());
                    // Filtrar: misma OT JDE, distinto _id, y misma semana si ambos la tienen
                    const mismos = hermanos.filter(h => {
                      if (h._id === otBase._id) return false;
                      if (otBase.programacionSemanalId && h.programacionSemanalId) {
                        return h.programacionSemanalId === otBase.programacionSemanalId;
                      }
                      return true;
                    });
                    if (mismos.length > 0) {
                      // Fusionar técnicos sin duplicar por nombre
                      const nombresYa = new Set(otBase.tecnicos.map(t => t.nombreCompleto));
                      const tecnicosMerged = [
                        ...otBase.tecnicos,
                        ...mismos.flatMap(h => h.tecnicos).filter(t => !nombresYa.has(t.nombreCompleto)),
                      ];
                      // Fusionar registrosDiarios de TODOS los hermanos (no solo misma semana)
                      // para capturar avances agregados en semanas distintas al padre
                      const todosHermanos = hermanos.filter(h => h._id !== otBase._id);
                      const diariosMerged = [
                        ...(otBase.registrosDiarios ?? []),
                        ...todosHermanos.flatMap(h => h.registrosDiarios ?? []),
                      ].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
                      // Fusionar lineas: misma tag+tipoOT → combinar adjuntos y tareas.
                      // Cada tarea se antepone con la fecha de la hija de origen ([dd/mm]) para no
                      // perder el día en que se ejecutó al fusionar varias hijas en una sola fila,
                      // y se recorre en orden cronológico para que las tareas queden ordenadas.
                      // El dedup es por fecha+texto (no solo texto) para no colapsar tareas iguales
                      // hechas en días distintos.
                      const fmtDia = (f: string) => {
                        const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T12:00:00` : f);
                        return d.toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" });
                      };
                      type LineaMerge = Omit<Linea, "adjuntos" | "tareasEjecutadas"> & {
                        adjuntos: AdjuntoLinea[];
                        tareasEjecutadas: string[];
                        tareasVistas: Set<string>;
                      };
                      const conFecha = [
                        { fecha: otBase.fecha, lineas: otBase.lineas },
                        ...mismos.map(h => ({ fecha: h.fecha, lineas: h.lineas })),
                      ].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
                      const lineasMap = new Map<string, LineaMerge>();
                      for (const { fecha, lineas } of conFecha) {
                        for (const l of lineas) {
                          const key = `${l.tag}::${l.tipoOT}`;
                          let existing = lineasMap.get(key);
                          if (!existing) {
                            existing = { ...l, adjuntos: [...(l.adjuntos ?? [])], tareasEjecutadas: [], tareasVistas: new Set() };
                            lineasMap.set(key, existing);
                          } else {
                            const adjNombres = new Set((existing.adjuntos ?? []).map(a => a.nombre));
                            for (const adj of (l.adjuntos ?? [])) {
                              if (!adjNombres.has(adj.nombre)) {
                                existing.adjuntos.push(adj);
                                adjNombres.add(adj.nombre);
                              }
                            }
                          }
                          for (const t of (l.tareasEjecutadas ?? [])) {
                            const conPrefijo = `[${fmtDia(fecha)}] ${t}`;
                            if (!existing.tareasVistas.has(conPrefijo)) {
                              existing.tareasVistas.add(conPrefijo);
                              existing.tareasEjecutadas.push(conPrefijo);
                            }
                          }
                        }
                      }
                      const lineasMerged: Linea[] = Array.from(lineasMap.values()).map(l => {
                        const { tareasVistas, ...resto } = l;
                        void tareasVistas;
                        return resto;
                      });
                      otParaPDF = { ...otBase, tecnicos: tecnicosMerged, registrosDiarios: diariosMerged, lineas: lineasMerged };
                    }
                  } catch { /* usa otBase sin fusión si falla el fetch */ }

                  // HH Estimadas = suma de hhTotal del plan semanal para el número OPEPLANT
                  // Se pasa como hhEstimadasPlan (campo separado) para no contaminar las lineas.
                  if (otBase.programacionSemanalId && otBase.otJdeNumero) {
                    try {
                      const plan = await fetch(`/api/programacion-semanal?id=${otBase.programacionSemanalId}`).then(r => r.json());
                      const otsDelPlan: { numeroOT: string; hhTotal: number }[] = plan?.otsProgramadas ?? [];
                      const hhEstPlan = otsDelPlan
                        .filter(o => String(o.numeroOT).toUpperCase() === String(otBase.otJdeNumero).toUpperCase())
                        .reduce((s, o) => s + (o.hhTotal ?? 0), 0);
                      if (hhEstPlan > 0) {
                        otParaPDF = { ...otParaPDF, hhEstimadasPlan: hhEstPlan };
                      }
                    } catch { /* mantiene estimado original si falla */ }
                  }
                }
                void generarInformeOT(otParaPDF);
              }}
              style={{ background: "#0d2847", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              Descargar Informe PDF
            </button>
          </div>
        )}

        {/* ── Avances Diarios (OTs multi-día del plan) ── */}
        {ot.origenPlan && (() => {
          const hhDiarios = (ot.registrosDiarios ?? []).reduce((s, r) => s + r.hhTrabajadas, 0);
          const diasDiarios = ot.registrosDiarios?.length ?? 0;
          // El día 1 de una OT recurrente ya queda registrado como el primer registrosDiarios
          // (ver POST /api/ordenes), así que las horas de ot.lineas solo se suman aparte
          // cuando todavía no existe ningún registro diario (OT de un solo día, sin desglose).
          const hhLineas = ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
          const diasLineas = diasDiarios === 0 && hhLineas > 0 ? 1 : 0;
          const totalDias = diasLineas + diasDiarios;
          const totalHH = diasDiarios > 0 ? hhDiarios : hhLineas;
          const puedeAgregarAvance = !["pendiente_revision", "revisado", "concluido"].includes(ot.estado);
          return (
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>
                  Avances diarios
                  {totalDias > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "2px 7px" }}>
                      {totalDias} día{totalDias !== 1 ? "s" : ""} · {totalHH}HH acumuladas
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Registro de trabajo por día para esta OT del plan</p>
              </div>
              {puedeAgregarAvance && (esTecnico || esAdmin) && !showAvance && (
                <button
                  onClick={() => setShowAvance(true)}
                  style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  + Agregar avance del día
                </button>
              )}
            </div>

            {/* Formulario de nuevo avance */}
            {showAvance && (
              <div style={{ background: "#eff6ff", border: "2px solid #bfdbfe", borderRadius: 10, padding: "14px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1d4ed8", marginBottom: 12 }}>Avance del día</div>
                <div style={{ display: "grid", gridTemplateColumns: "160px 120px", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={S.label}>Fecha</label>
                    <input type="date" value={avanceForm.fecha}
                      onChange={e => setAvanceForm(f => ({ ...f, fecha: e.target.value }))}
                      style={S.input} />
                  </div>
                  <div>
                    <label style={S.label}>HH trabajadas</label>
                    <input type="number" min="0" step="0.5" value={avanceForm.hhTrabajadas || ""}
                      onChange={e => setAvanceForm(f => ({ ...f, hhTrabajadas: Number(e.target.value) }))}
                      style={S.input} />
                  </div>
                </div>

                {/* Tareas del día */}
                <div style={{ marginBottom: 10 }}>
                  <label style={S.label}>Tareas ejecutadas hoy</label>
                  {avanceForm.tareasEjecutadas.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ flex: 1, fontSize: 13, background: "white", borderRadius: 6, padding: "5px 9px", border: "1px solid #e2e8f0" }}>{t}</span>
                      <button type="button"
                        onClick={() => setAvanceForm(f => ({ ...f, tareasEjecutadas: f.tareasEjecutadas.filter((_, j) => j !== i) }))}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={avanceTareaInput}
                      onChange={e => setAvanceTareaInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && avanceTareaInput.trim()) {
                          e.preventDefault();
                          setAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, avanceTareaInput.trim()] }));
                          setAvanceTareaInput("");
                        }
                      }}
                      placeholder="Describir tarea y presionar Enter…"
                      style={{ ...S.input, fontSize: 13 }} />
                    <button type="button"
                      onClick={() => { if (avanceTareaInput.trim()) { setAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, avanceTareaInput.trim()] })); setAvanceTareaInput(""); } }}
                      style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap" as const }}>+ Tarea</button>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Detalle de trabajo</label>
                  <textarea value={avanceForm.observaciones}
                    onChange={e => setAvanceForm(f => ({ ...f, observaciones: e.target.value }))}
                    placeholder="Estado del trabajo, materiales usados, pendientes…"
                    style={{ ...S.textarea, minHeight: 52 }} />
                </div>

                {/* Evidencias del avance */}
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Evidencias (fotos / documentos)</label>
                  {avanceForm.adjuntos.map((adj, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "#f8fafc", borderRadius: 7, padding: "6px 10px", border: "1px solid #e2e8f0" }}>
                      <span style={{ fontSize: 16 }}>{adj.tipo === "foto" ? "📷" : "📄"}</span>
                      <span style={{ flex: 1, fontSize: 12, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{adj.nombre}</span>
                      <input value={adj.comentario} placeholder="Observación…"
                        onChange={e => { const upd = [...avanceForm.adjuntos]; upd[i] = { ...upd[i], comentario: e.target.value }; setAvanceForm(f => ({ ...f, adjuntos: upd })); }}
                        style={{ ...S.input, width: 160, fontSize: 12 }} />
                      <button type="button" onClick={() => setAvanceForm(f => ({ ...f, adjuntos: f.adjuntos.filter((_, j) => j !== i) }))}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 4 }}>
                    {(["📷 Tomar foto", "🖼️ Galería (JPG/PNG)", "📄 Documento"] as const).map((label, idx) => (
                      <label key={idx} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", border: "1.5px dashed #94a3b8", borderRadius: 7, cursor: cargandoAdjAvance ? "not-allowed" : "pointer", background: "white", fontSize: 12, color: "#475569", fontWeight: 600 }}>
                        {cargandoAdjAvance && idx === 0 ? "Procesando…" : label}
                        <input type="file" style={{ display: "none" }} disabled={cargandoAdjAvance}
                          accept={idx === 2 ? ".pdf,.doc,.docx,.xls,.xlsx" : idx === 0 ? "image/*" : "image/jpeg,image/png,image/heic,image/webp"}
                          {...(idx === 0 ? { capture: "environment" as const } : {})}
                          onChange={async e => {
                            const file = e.target.files?.[0]; if (!file) return;
                            setCargandoAdjAvance(true);
                            try {
                              const esImg = file.type.startsWith("image/");
                              const dataUrl = esImg ? await comprimirImagen(file) : await new Promise<string>(res => { const r = new FileReader(); r.onload = ev => res(ev.target!.result as string); r.readAsDataURL(file); });
                              setAvanceForm(f => ({ ...f, adjuntos: [...f.adjuntos, { tipo: esImg ? "foto" : "documento", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] }));
                            } finally { setCargandoAdjAvance(false); e.target.value = ""; }
                          }} />
                      </label>
                    ))}
                  </div>
                </div>

                {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>⚠ {saveErr}</p>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => { setShowAvance(false); setSaveErr(""); }} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }}>Cancelar</button>
                  <button onClick={guardarAvance} disabled={saving} style={{ ...S.btnGreen, padding: "8px 18px", fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Guardando…" : "Guardar avance"}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de avances existentes */}
            {(ot.registrosDiarios?.length ?? 0) === 0 && !showAvance ? (
              <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Sin avances registrados aún. El técnico debe agregar el trabajo de cada día.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(ot.registrosDiarios ?? []).map((r, i) => {
                  const isEditing = editingAvanceId === r._id;
                  return (
                  <div key={r._id ?? i} style={{ background: isEditing ? "#fffbeb" : "#f8fafc", borderRadius: 10, border: `1px solid ${isEditing ? "#fcd34d" : "#e2e8f0"}`, padding: "12px 14px", borderLeft: `3px solid ${isEditing ? "#f59e0b" : "#2563eb"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontWeight: 800, fontSize: 13, color: "#0f2847" }}>
                          {new Date(r.fecha).toLocaleDateString("es-BO", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "2px 8px" }}>{r.hhTrabajadas}HH</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{r.tecnico}</span>
                        {(esSup || (esTecnico && esOtPropia && puedeEditarTecnico)) && r._id && !isEditing && (
                          <button
                            onClick={() => {
                              setEditingAvanceId(r._id!);
                              setEditAvanceForm({ fecha: new Date(r.fecha).toISOString().split("T")[0], hhTrabajadas: r.hhTrabajadas, tareasEjecutadas: [...r.tareasEjecutadas], observaciones: r.observaciones ?? "", tareaInput: "", adjuntos: [...(r.adjuntos ?? [])] });
                            }}
                            style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                            title="Editar este avance">
                            ✏
                          </button>
                        )}
                        {(esSup || (esTecnico && esOtPropia && puedeEditarTecnico)) && r._id && !isEditing && (
                          <button
                            onClick={() => setDeletingAvanceId(r._id!)}
                            style={{ background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                            title="Eliminar este avance">
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Formulario de edición inline */}
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "140px 120px 1fr", gap: 10 }}>
                          <div>
                            <label style={S.label}>Fecha</label>
                            <input type="date"
                              value={editAvanceForm.fecha}
                              onChange={e => setEditAvanceForm(f => ({ ...f, fecha: e.target.value }))}
                              style={S.input} />
                          </div>
                          <div>
                            <label style={S.label}>HH trabajadas</label>
                            <input type="number" min="0" step="0.5"
                              value={editAvanceForm.hhTrabajadas || ""}
                              onChange={e => setEditAvanceForm(f => ({ ...f, hhTrabajadas: Number(e.target.value) }))}
                              style={S.input} />
                          </div>
                          <div>
                            <label style={S.label}>Detalle de trabajo</label>
                            <input type="text"
                              value={editAvanceForm.observaciones}
                              onChange={e => setEditAvanceForm(f => ({ ...f, observaciones: e.target.value }))}
                              placeholder="Observaciones del día…"
                              style={S.input} />
                          </div>
                        </div>
                        <div>
                          <label style={S.label}>Tareas ejecutadas</label>
                          {editAvanceForm.tareasEjecutadas.map((t, ti) => (
                            <div key={ti} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ flex: 1, fontSize: 12, background: "white", borderRadius: 6, padding: "4px 8px", border: "1px solid #e2e8f0" }}>{t}</span>
                              <button type="button"
                                onClick={() => setEditAvanceForm(f => ({ ...f, tareasEjecutadas: f.tareasEjecutadas.filter((_, j) => j !== ti) }))}
                                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>✕</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 6 }}>
                            <input value={editAvanceForm.tareaInput}
                              onChange={e => setEditAvanceForm(f => ({ ...f, tareaInput: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter" && editAvanceForm.tareaInput.trim()) { e.preventDefault(); setEditAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, f.tareaInput.trim()], tareaInput: "" })); } }}
                              placeholder="Nueva tarea — Enter para agregar"
                              style={{ ...S.input, fontSize: 12 }} />
                            <button type="button"
                              onClick={() => { if (editAvanceForm.tareaInput.trim()) setEditAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, f.tareaInput.trim()], tareaInput: "" })); }}
                              style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" as const }}>+ Tarea</button>
                          </div>
                        </div>
                        {/* Evidencias al editar */}
                        <div style={{ marginTop: 8, marginBottom: 8 }}>
                          <label style={S.label}>Evidencias (fotos / documentos)</label>
                          {editAvanceForm.adjuntos.map((adj, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, background: "#fffbeb", borderRadius: 6, padding: "5px 9px", border: "1px solid #fde68a" }}>
                              <span style={{ fontSize: 15 }}>{adj.tipo === "foto" ? "📷" : "📄"}</span>
                              <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{adj.nombre}</span>
                              <input value={adj.comentario} placeholder="Observación…"
                                onChange={e => { const upd = [...editAvanceForm.adjuntos]; upd[i] = { ...upd[i], comentario: e.target.value }; setEditAvanceForm(f => ({ ...f, adjuntos: upd })); }}
                                style={{ ...S.input, width: 150, fontSize: 12 }} />
                              <button type="button" onClick={() => setEditAvanceForm(f => ({ ...f, adjuntos: f.adjuntos.filter((_, j) => j !== i) }))}
                                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>✕</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, marginTop: 4 }}>
                            {(["📷 Tomar foto", "🖼️ Galería", "📄 Documento"] as const).map((label, idx) => (
                              <label key={idx} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", border: "1.5px dashed #94a3b8", borderRadius: 6, cursor: cargandoAdjAvance ? "not-allowed" : "pointer", background: "white", fontSize: 11, color: "#475569", fontWeight: 600 }}>
                                {label}
                                <input type="file" style={{ display: "none" }} disabled={cargandoAdjAvance}
                                  accept={idx === 2 ? ".pdf,.doc,.docx,.xls,.xlsx" : idx === 0 ? "image/*" : "image/jpeg,image/png,image/heic,image/webp"}
                                  {...(idx === 0 ? { capture: "environment" as const } : {})}
                                  onChange={async e => {
                                    const file = e.target.files?.[0]; if (!file) return;
                                    setCargandoAdjAvance(true);
                                    try {
                                      const esImg = file.type.startsWith("image/");
                                      const dataUrl = esImg ? await comprimirImagen(file) : await new Promise<string>(res => { const r = new FileReader(); r.onload = ev => res(ev.target!.result as string); r.readAsDataURL(file); });
                                      setEditAvanceForm(f => ({ ...f, adjuntos: [...f.adjuntos, { tipo: esImg ? "foto" : "documento", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] }));
                                    } finally { setCargandoAdjAvance(false); e.target.value = ""; }
                                  }} />
                              </label>
                            ))}
                          </div>
                        </div>
                        {saveErr && <p style={{ color: "#dc2626", fontSize: 12 }}>⚠ {saveErr}</p>}
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button onClick={() => { setEditingAvanceId(null); setSaveErr(""); }} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}>Cancelar</button>
                          <button onClick={guardarEdicionAvance} disabled={saving} style={{ ...S.btnAmber, padding: "6px 14px", fontSize: 12, opacity: saving ? 0.6 : 1 }}>
                            {saving ? "Guardando…" : "Guardar cambios"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {r.tareasEjecutadas.length > 0 && (
                          <ul style={{ margin: "4px 0 6px 0", paddingLeft: 16 }}>
                            {r.tareasEjecutadas.map((t, ti) => (
                              <li key={ti} style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>{t}</li>
                            ))}
                          </ul>
                        )}
                        {r.observaciones && (
                          <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>{r.observaciones}</p>
                        )}
                        {(r.adjuntos ?? []).length > 0 && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 6 }}>
                            {(r.adjuntos ?? []).map((adj, ai) => (
                              <span key={ai} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 5, padding: "2px 8px", color: "#0369a1" }}>
                                {adj.tipo === "foto" ? "📷" : "📄"} {adj.nombre}
                                {adj.comentario && <span style={{ color: "#64748b" }}> — {adj.comentario}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  );
                })}
                {/* Totales */}
                {totalDias > 1 && (
                  <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 14px", display: "flex", gap: 24 }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>Total días</span>
                      <p style={{ fontSize: 16, fontWeight: 800, color: "#0369a1" }}>{totalDias}</p>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>HH acumuladas</span>
                      <p style={{ fontSize: 16, fontWeight: 800, color: "#0369a1" }}>{totalHH}HH</p>
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>Técnicos</span>
                      <p style={{ fontSize: 12, color: "#0369a1" }}>{[...new Set([...ot.tecnicos.map(t => t.nombreCompleto), ...(ot.registrosDiarios ?? []).flatMap(r => r.tecnico.split(",").map((n: string) => n.trim()))])].filter(Boolean).join(", ")}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* Historial */}
        {ot.historialCambios.length > 0 && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Historial de cambios</div>
            {[...ot.historialCambios].reverse().map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: i < ot.historialCambios.length - 1 ? 10 : 0, marginBottom: i < ot.historialCambios.length - 1 ? 10 : 0, borderBottom: i < ot.historialCambios.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb", marginTop: 5, flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 13, color: "#1e293b", fontWeight: 500, lineHeight: 1.4 }}>{c.cambio}</p>
                  <p style={{ fontSize: 11, color: "#94a3b8" }}>{c.nombreUsuario} · {new Date(c.fechaHora).toLocaleString("es-BO")}</p>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>

    {/* Modal agregar evidencia */}
    {evidenciaModal && selected && (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => { setEvidenciaModal(null); setEvidenciaPreview(null); }}
      >
        <div
          style={{ background: "white", borderRadius: 14, padding: 24, maxWidth: 420, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: 15, color: "#0f2847", marginBottom: 4 }}>
            Agregar evidencia
          </div>
          <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
            {evidenciaModal.lineaTag} · {evidenciaModal.lineaTipoOT}
          </p>

          {/* Preview de la imagen seleccionada */}
          {evidenciaPreview ? (
            <div style={{ marginBottom: 14, position: "relative" }}>
              {evidenciaPreview.tipo === "foto"
                ? <img src={evidenciaPreview.dataUrl} alt={evidenciaPreview.nombre} style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, border: "1px solid #e2e8f0" }} />
                : <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, textAlign: "center" as const }}>📄 {evidenciaPreview.nombre}</div>
              }
              <button
                onClick={() => { setEvidenciaPreview(null); }}
                style={{ position: "absolute", top: 6, right: 6, background: "#dc2626", color: "white", border: "none", borderRadius: "50%", width: 22, height: 22, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >✕</button>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                style={{ display: "none" }}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const esImagen = file.type.startsWith("image/");
                  const dataUrl = esImagen ? await comprimirImagen(file) : await new Promise<string>(res => {
                    const r = new FileReader(); r.onload = ev => res(ev.target!.result as string); r.readAsDataURL(file);
                  });
                  setEvidenciaPreview({ dataUrl, nombre: file.name, tipo: esImagen ? "foto" : "documento" });
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ width: "100%", border: "2px dashed #cbd5e1", borderRadius: 10, padding: "24px 0", background: "#f8fafc", color: "#64748b", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
              >
                📷 Seleccionar foto o documento
              </button>
            </div>
          )}

          {/* Comentario */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>Comentario / descripción</label>
            <input
              value={evidenciaComentario}
              onChange={e => setEvidenciaComentario(e.target.value)}
              placeholder="Ej: Estado del equipo al momento de la intervención"
              style={{ ...S.input, fontSize: 13 }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => { setEvidenciaModal(null); setEvidenciaPreview(null); }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#64748b" }}
            >
              Cancelar
            </button>
            <button
              disabled={!evidenciaPreview || !evidenciaComentario.trim() || evidenciaSaving}
              onClick={async () => {
                if (!evidenciaPreview || !evidenciaComentario.trim()) return;
                setEvidenciaSaving(true);
                try {
                  // Construir lineas actualizadas con el nuevo adjunto en la linea correcta
                  const lineasActualizadas = selected.lineas.map(l => {
                    if (l.tag !== evidenciaModal.lineaTag || l.tipoOT !== evidenciaModal.lineaTipoOT) return l;
                    return {
                      ...l,
                      adjuntos: [
                        ...(l.adjuntos ?? []),
                        { tipo: evidenciaPreview.tipo, nombre: evidenciaPreview.nombre, dataUrl: evidenciaPreview.dataUrl, comentario: evidenciaComentario.trim(), comentariosExtra: [] },
                      ],
                    };
                  });
                  const res = await fetch(`/api/ordenes/${selected._id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      lineas: lineasActualizadas,
                      cambio: `Evidencia añadida en ${evidenciaModal.lineaTag} por ${user?.nombre ?? "supervisor"}`,
                      usuarioId: user?.id ?? "sistema",
                      nombreUsuario: user?.nombre ?? "Sistema",
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? "Error al guardar");
                  setSelected(data.ot);
                  setOrdenes(prev => prev.map(o => o._id === data.ot._id ? data.ot : o));
                  setEvidenciaModal(null);
                  setEvidenciaPreview(null);
                  setEvidenciaComentario("");
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : "Error al guardar la evidencia");
                } finally {
                  setEvidenciaSaving(false);
                }
              }}
              style={{ flex: 2, padding: "10px 0", borderRadius: 8, border: "none", background: evidenciaPreview && evidenciaComentario.trim() ? "#16a34a" : "#94a3b8", fontWeight: 700, fontSize: 13, cursor: evidenciaPreview && evidenciaComentario.trim() ? "pointer" : "not-allowed", color: "white", opacity: evidenciaSaving ? 0.6 : 1 }}
            >
              {evidenciaSaving ? "Guardando…" : "Guardar evidencia"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal confirmación eliminar */}
    {deletingId && (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setDeletingId(null)}
      >
        <div
          style={{ background: "white", borderRadius: 12, padding: 28, maxWidth: 360, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: 16, color: "#0f2847", marginBottom: 8 }}>Eliminar OT</div>
          <p style={{ fontSize: 14, color: "#475569", marginBottom: 20, lineHeight: 1.5 }}>
            Esta acción eliminará permanentemente la OT y todos sus datos (líneas, técnicos, historial). No se puede deshacer.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setDeletingId(null)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#64748b" }}
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                const id = deletingId;
                setDeletingId(null);
                const res = await fetch(`/api/ordenes/${id}`, { method: "DELETE" });
                if (res.ok) {
                  setOrdenes(prev => prev.filter(o => o._id !== id));
                  if (selected?._id === id) setSelected(null);
                } else {
                  alert("Error al eliminar la OT");
                }
              }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#dc2626", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "white" }}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    )}
    {/* Modal confirmación eliminar avance diario */}
    {deletingAvanceId && selected && (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setDeletingAvanceId(null)}
      >
        <div
          style={{ background: "white", borderRadius: 12, padding: 28, maxWidth: 360, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: 16, color: "#0f2847", marginBottom: 8 }}>Eliminar avance diario</div>
          <p style={{ fontSize: 14, color: "#475569", marginBottom: 20, lineHeight: 1.5 }}>
            Se eliminará este registro de avance. Esta acción no se puede deshacer.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setDeletingAvanceId(null)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#64748b" }}
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                const avanceId = deletingAvanceId;
                setDeletingAvanceId(null);
                const res = await fetch(`/api/ordenes/${selected._id}/avances/${avanceId}`, { method: "DELETE" });
                if (res.ok) {
                  setSelected(prev => prev ? {
                    ...prev,
                    registrosDiarios: (prev.registrosDiarios ?? []).filter(r => r._id !== avanceId),
                  } : prev);
                } else {
                  alert("Error al eliminar el avance");
                }
              }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#dc2626", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "white" }}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
