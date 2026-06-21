"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { generarInformeOT } from "@/lib/generarInformeOT";

// â”€â”€â”€ Utilidades de imagen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  tiempoEstimadoHrs?: number;
  tiempoRealHrs?: number;
  descripcionTrabajo?: string;
  tareasEjecutadas?: string[];
  observaciones?: string;
  inspeccion?: Inspeccion | null;
  adjuntos?: AdjuntoLinea[];
};

type SupForm = {
  requierePlanificacion: boolean; // "Requiere WR" en UI
  comentariosSupervisor: string;  // separado por "\n" para mÃºltiples comentarios
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
  datosSupervision: Partial<SupForm> & { codigoModoFallaISO?: string; revisadoPor?: string; revisadoEn?: string };
  historialCambios: { fechaHora: string; usuarioId: string; nombreUsuario: string; cambio: string }[];
  registrosDiarios?: RegistroDiario[];
  // Enlace al plan semanal
  origenPlan?: boolean;
  programacionSemanalId?: string;
  otJdeNumero?: string;
  otJdeDia?: string;
  createdAt?: string;
};

type AreaOpt = { codigo: string; nombre: string };

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  pendiente_revision: "Pend. revisiÃ³n",
  solicitar_correccion: "CorrecciÃ³n",
  revisado: "Revisado",
  concluido: "Concluido",
};

const TIPO_COLOR: Record<string, string> = {
  CMP: "#dc2626", CMR: "#d97706", PMP: "#2563eb", PMT: "#0891b2", PDM: "#059669", PTJ: "#7c3aed",
};

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
  { key: "pendiente_revision",   label: "Pend. RevisiÃ³n",   color: "#d97706" },
  { key: "solicitar_correccion", label: "CorrecciÃ³n",       color: "#dc2626" },
  { key: "revisado",             label: "Revisado",         color: "#2563eb" },
  { key: "concluido",            label: "Concluido",        color: "#16a34a" },
];

// â”€â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function diffLineas(original: Linea[], editado: Linea[]): string[] {
  const msgs: string[] = [];
  editado.forEach((linea, i) => {
    const orig = original[i];
    if (!orig) return;
    if (linea.tiempoEstimadoHrs !== orig.tiempoEstimadoHrs) {
      msgs.push(`[${linea.tag}] HH estimadas: ${orig.tiempoEstimadoHrs ?? "â€”"}HH â†’ ${linea.tiempoEstimadoHrs ?? "â€”"}HH`);
    }
    if (linea.tiempoRealHrs !== orig.tiempoRealHrs) {
      msgs.push(`[${linea.tag}] HH trabajadas: ${orig.tiempoRealHrs ?? "â€”"}HH â†’ ${linea.tiempoRealHrs ?? "â€”"}HH`);
    }
    if (linea.resolucionAplicada !== orig.resolucionAplicada) {
      msgs.push(`[${linea.tag}] ResoluciÃ³n actualizada`);
    }
    if (linea.observaciones !== orig.observaciones) {
      msgs.push(`[${linea.tag}] Observaciones actualizadas`);
    }
  });
  return msgs.length > 0 ? ["EdiciÃ³n con trazabilidad:", ...msgs] : ["Sin cambios detectados"];
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ReporteOTPage() {
  const { user } = useUser();
  const [otParamId, setOtParamId] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("ot");
    setOtParamId(p);
  }, []);

  // Derivados de rol â€” Admin(1) y Superintendente(2) tienen acceso total
  const esTecnico   = user?.rol === 4 || user?.rol === 6; // rol 6 = Contratista, mismos permisos que tÃ©cnico
  const esSup       = user ? user.rol <= 3 || user.rol === 5 : false; // 1, 2, 3 y 5 pueden revisar
  const esAdmin     = user?.rol === 1;

  const [ordenes, setOrdenes] = useState<OTDoc[]>([]);
  const [areas, setAreas] = useState<AreaOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OTDoc | null>(null);
  const [viewMode, setViewMode] = useState<"lista" | "tablero">("lista");

  // â”€â”€â”€ Helpers de fechas para filtros de perÃ­odo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Capa 1 & 2 â€” Filtro de perÃ­odo (default: Ãºltimas 3 semanas)
  const [periodo, setPeriodo] = useState<Periodo>("3semanas");
  const [filtroFechaDesde, setFiltroFechaDesde] = useState(restarDias(21));
  const [filtroFechaHasta, setFiltroFechaHasta] = useState("");

  // SupervisiÃ³n
  const [supForm, setSupForm] = useState<SupForm>(EMPTY_SUP);
  const [supComentarioInput, setSupComentarioInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  // Modo ediciÃ³n con trazabilidad
  const [editMode, setEditMode] = useState(false);
  const [editLineas, setEditLineas] = useState<Linea[]>([]);
  const [editOtJdeNumero, setEditOtJdeNumero] = useState("");
  const [editTurno, setEditTurno] = useState("");
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
  const [editAvanceForm, setEditAvanceForm] = useState<{ hhTrabajadas: number; tareasEjecutadas: string[]; observaciones: string; tareaInput: string }>({ hhTrabajadas: 0, tareasEjecutadas: [], observaciones: "", tareaInput: "" });

  // Modal agregar evidencia (foto/documento) desde panel supervisor
  const [evidenciaModal, setEvidenciaModal] = useState<{ lineaTag: string; lineaTipoOT: string } | null>(null);
  const [evidenciaComentario, setEvidenciaComentario] = useState("");
  const [evidenciaPreview, setEvidenciaPreview] = useState<{ dataUrl: string; nombre: string; tipo: "foto" | "documento" } | null>(null);
  const [evidenciaSaving, setEvidenciaSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Avance diario (OTs multi-dÃ­a)
  const [showAvance, setShowAvance]   = useState(false);
  const [avanceTareaInput, setAvanceTareaInput] = useState("");
  const [avanceForm, setAvanceForm]   = useState<{
    fecha: string; hhTrabajadas: number; tareasEjecutadas: string[]; observaciones: string;
  }>({ fecha: new Date().toISOString().split("T")[0], hhTrabajadas: 0, tareasEjecutadas: [], observaciones: "" });

  const loadOrdenes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filtroEstado) params.set("estado", filtroEstado);
      if (filtroArea) params.set("area", filtroArea);
      if (filtroFechaDesde) params.set("fechaDesde", filtroFechaDesde);
      if (filtroFechaHasta) params.set("fechaHasta", filtroFechaHasta);
      if (periodo === "todo") params.set("incluirArchivados", "true");
      const data = await fetch(`/api/ordenes?${params}`).then((r) => r.json());
      setOrdenes(Array.isArray(data) ? data : []);
    } catch { setOrdenes([]); }
    finally { setLoading(false); }
  }, [filtroEstado, filtroArea, filtroFechaDesde, filtroFechaHasta, periodo]);

  useEffect(() => { fetch("/api/areas").then((r) => r.json()).then(setAreas).catch(() => {}); }, []);
  useEffect(() => { loadOrdenes(); }, [loadOrdenes]);

  // Auto-seleccionar OT si viene el parÃ¡metro ?ot=<id> desde programa semanal
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?._id]);

  const ordenesFiltradas = ordenes.filter((o) => {
    // TÃ©cnico/Contratista solo ve sus propias OTs
    if (esTecnico && user) {
      const tokensUser = user.nombre.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").split(/\s+/).filter(t => t.length > 2);
      const esAsignado = o.tecnicos.some(t => {
        if (t.usuarioId && t.usuarioId === user.id) return true;
        const nombreNorm = t.nombreCompleto.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
        return tokensUser.some(tok => nombreNorm.includes(tok));
      });
      if (!esAsignado) return false;
    }
    // Supervisor con Ã¡reas asignadas solo ve OTs de sus Ã¡reas
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
    setEditTecnicos(selected.tecnicos.map(t => ({ usuarioId: t.usuarioId ?? "", nombreCompleto: t.nombreCompleto })));
    fetch(`/api/usuarios?rol=4&area=${selected.areaCodigo}&all=true`).then(r => r.json()).then(setUsuariosDisponibles).catch(() => {});
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
    return l.inspeccion ?? { checklistId: "", checklistNombre: "Checklist supervisiÃ³n", items: [] };
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
            tecnico:          user?.nombre ?? "TÃ©cnico",
            usuarioId:        user?.id,
            hhTrabajadas:     avanceForm.hhTrabajadas,
            tareasEjecutadas: avanceForm.tareasEjecutadas,
            observaciones:    avanceForm.observaciones,
          },
          cambio: `Avance del dÃ­a ${avanceForm.fecha} registrado por ${user?.nombre ?? "TÃ©cnico"} â€” ${avanceForm.hhTrabajadas}HH`,
          usuarioId: user?.id ?? "system",
          nombreUsuario: user?.nombre ?? "Sistema",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setSelected(data.ot);
      setOrdenes(prev => prev.map(o => o._id === data.ot._id ? data.ot : o));
      setShowAvance(false);
      setAvanceForm({ fecha: new Date().toISOString().split("T")[0], hhTrabajadas: 0, tareasEjecutadas: [], observaciones: "" });
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
            fecha:            avance.fecha,
            tecnico:          avance.tecnico,
            usuarioId:        avance.usuarioId,
            hhTrabajadas:     editAvanceForm.hhTrabajadas,
            tareasEjecutadas: editAvanceForm.tareasEjecutadas,
            observaciones:    editAvanceForm.observaciones,
          },
          cambio: `Avance del dÃ­a ${avance.fecha} editado por ${user?.nombre ?? "Supervisor"}`,
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

  async function cambiarEstado(nuevoEstado: EstadoOT, descripcion: string) {
    if (!selected) return;
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch(`/api/ordenes/${selected._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: nuevoEstado, datosSupervision: supForm,
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

  // â”€â”€â”€ Lista â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (!selected) {
    return (
      <div style={S.page}>
        <AppHeader backHref="/ordenes" />
        <div style={S.wrap}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 2 }}>Ã“rdenes de Trabajo</h1>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Borradores Â· RevisiÃ³n Â· Concluidas</p>
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
                  {m === "lista" ? "â˜° Lista" : "âŠž Tablero"}
                </button>
              ))}
            </div>
          </div>

          {/* Filtros (solo en lista) */}
          {viewMode === "lista" && (
            <div style={{ ...S.card, marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label style={S.label}>Buscar</label>
                  <input value={filtroBuscar} onChange={(e) => setFiltroBuscar(e.target.value)} placeholder="# OT, tÃ©cnico, TAGâ€¦" style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Estado</label>
                  <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={S.select}>
                    <option value="">Todos</option>
                    {COLS_TABLERO.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Ãrea</label>
                  <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)} style={S.select}>
                    <option value="">Todas</option>
                    {(user?.rol === 3 && user.areas?.length > 0
                      ? areas.filter(a => user.areas.includes(a.codigo))
                      : areas
                    ).map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} â€” {a.nombre}</option>)}
                  </select>
                </div>
              </div>

              {/* â”€â”€â”€ Filtro de perÃ­odo (Capa 1 & 2) â”€â”€â”€ */}
              <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                <label style={{ ...S.label, display: "block", marginBottom: 6 }}>PerÃ­odo</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {(
                    [
                      { key: "semana",     label: "Esta semana" },
                      { key: "semana_ant", label: "Semana pasada" },
                      { key: "3semanas",   label: "Ãšltimas 3 sem." },
                      { key: "mes",        label: "Ãšltimo mes" },
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

                {/* Aviso cuando se estÃ¡ viendo historial completo (Capa 3) */}
                {periodo === "todo" && (
                  <p style={{ fontSize: 11, color: "#f59e0b", marginTop: 6, fontWeight: 500 }}>
                    Mostrando historial completo â€” incluye OTs concluidas archivadas (&gt;90 dÃ­as).
                  </p>
                )}
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ fontSize: 12, color: "#64748b" }}>
              {loading ? "Cargandoâ€¦" : `${ordenesFiltradas.length} orden(es)`}
              {periodo !== "todo" && !loading && (
                <span style={{ marginLeft: 6, color: "#94a3b8" }}>
                  Â· {periodo === "semana" ? "esta semana" : periodo === "semana_ant" ? "semana pasada" : periodo === "3semanas" ? "Ãºltimas 3 semanas" : periodo === "mes" ? "Ãºltimo mes" : "rango personalizado"}
                </span>
              )}
            </p>
            <button onClick={loadOrdenes} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}>â†» Actualizar</button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 48, color: "#94a3b8", fontSize: 14 }}>Cargandoâ€¦</div>
          ) : viewMode === "lista" ? (
            /* â”€â”€ Vista Lista â”€â”€ */
            ordenesFiltradas.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
                <p style={{ color: "#94a3b8", fontSize: 14 }}>No hay Ã³rdenes con esos filtros.</p>
              </div>
            ) : (
              ordenesFiltradas.map((ot) => {
                const color = ESTADO_COLOR[ot.estado] ?? "#64748b";
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
                          {ot.lineas.map((l, i) => <span key={i} style={S.badge(TIPO_COLOR[l.tipoOT] ?? "#64748b")}>{l.tipoOT}</span>)}
                        </div>
                        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>
                          {new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })} Â· {ot.turno} Â· {areaNombre(ot.areaCodigo)}
                        </p>
                        <p style={{ fontSize: 12, color: "#475569" }}>{ot.tecnicos.map((t) => t.nombreCompleto).join(", ")}</p>
                        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ot.lineas.map((l) => l.tag).join(" Â· ")}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{ot.lineas.length} equipo(s)</span>
                        <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>Ver â†’</span>
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
                          ðŸ—‘ Eliminar OT
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            /* â”€â”€ Vista Tablero â”€â”€ */
            <div style={{ overflowX: "auto", paddingBottom: 12 }}>
              <div style={{ display: "flex", gap: 12, minWidth: 900 }}>
                {COLS_TABLERO.map((col) => {
                  const colOTs = ordenes.filter((o) => o.estado === col.key);
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
                          VacÃ­o
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
                                ðŸ“‹ PLAN Â· JDE {ot.otJdeNumero}
                              </span>
                            ) : (
                              <span style={{ fontSize: 9, fontWeight: 700, background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.04em" }}>
                                âš¡ REACTIVA
                              </span>
                            )}
                            {ot.lineas.map((l, i) => (
                              <span key={i} style={{ fontSize: 9, fontWeight: 700, background: (TIPO_COLOR[l.tipoOT] ?? "#64748b") + "20", color: TIPO_COLOR[l.tipoOT] ?? "#64748b", borderRadius: 4, padding: "1px 5px" }}>
                                {l.tipoOT}
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

                          {/* Acciones rÃ¡pidas */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <button
                              onClick={() => setSelected(ot)}
                              style={{ width: "100%", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                            >
                              Ver detalle â†’
                            </button>
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
                                  âœ“ Aprobar
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const res = await fetch(`/api/ordenes/${ot._id}`, {
                                      method: "PATCH", headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ estado: "solicitar_correccion", cambio: "Supervisor solicitÃ³ correcciÃ³n", usuarioId: user?.id ?? "sistema", nombreUsuario: user?.nombre ?? "Supervisor" }),
                                    });
                                    const data = await res.json();
                                    if (res.ok) setOrdenes((prev) => prev.map((o) => o._id === data.ot._id ? data.ot : o));
                                  }}
                                  style={{ width: "100%", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                                >
                                  âœ— CorrecciÃ³n
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
                                âœ“ Concluir
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

  // â”€â”€â”€ Detalle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const ot = selected;
  const estadoColor = ESTADO_COLOR[ot.estado] ?? "#64748b";
  const isConcluido = ot.estado === "concluido";

  // TÃ©cnico edita en borrador/correcciÃ³n; supervisor/admin en cualquier estado activo
  const enEstadoTecnico = ot.estado === "borrador" || ot.estado === "solicitar_correccion";

  // TÃ©cnico solo puede editar OTs donde Ã©l estÃ¡ asignado (por id o por nombre)
  const tokensNombre = (user?.nombre ?? "").toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").split(/\s+/).filter(t => t.length > 2);
  const esOtPropia = esTecnico && ot.tecnicos.some(t => {
    if (t.usuarioId && user?.id && t.usuarioId === user.id) return true;
    const nombreNorm = t.nombreCompleto.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
    return tokensNombre.some(tok => nombreNorm.includes(tok));
  });

  const canEdit = !isConcluido && (esAdmin || (esTecnico && enEstadoTecnico && esOtPropia) || (esSup && !esTecnico));

  // Solo tÃ©cnico (o admin) puede enviar a revisiÃ³n desde borrador/correcciÃ³n
  // Para OTs del plan (OPEPLANT): solo domingo o admin puede enviar a revisiÃ³n (cierre semanal)
  const bloqueoCierreSemanal = ot.origenPlan && new Date().getDay() !== 0 && !esAdmin;
  const canSendToReview = enEstadoTecnico && (esAdmin || (esTecnico && esOtPropia)) && !bloqueoCierreSemanal;

  // Formulario de supervisiÃ³n: solo supervisores/admins, cuando la OT estÃ¡ en pendiente_revision
  const showSupForm = esSup && ot.estado === "pendiente_revision";

  // Botones de aprobar/rechazar: supervisores/admins en pendiente_revision
  const canRevisar = esSup && ot.estado === "pendiente_revision";

  // BotÃ³n concluir: supervisores/admins en revisado
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
          <button onClick={() => setSelected(null)} style={{ ...S.btnGhost, padding: "7px 14px" }}>â† Lista</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847" }}>
                {ot.otJdeNumero ? `OT ${ot.otJdeNumero}` : `OT #${ot.numeroOT}`}
              </h1>
              <span style={S.badge(estadoColor)}>{ESTADO_LABEL[ot.estado]}</span>
              {ot.origenPlan ? (
                <span style={{ ...S.badge("#1d4ed8"), fontSize: 11 }}>
                  ðŸ“‹ Plan Semanal{ot.otJdeDia ? ` Â· ${ot.otJdeDia}` : ""}
                </span>
              ) : (
                <span style={{ ...S.badge("#dc2626"), fontSize: 11 }}>âš¡ Reactiva</span>
              )}
              {editMode && <span style={{ ...S.badge("#f59e0b"), fontSize: 11 }}>âœ Modo ediciÃ³n</span>}
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8" }}>{new Date(ot.fecha).toLocaleDateString("es-BO", { timeZone: "UTC" })} Â· {ot.turno}</p>
          </div>
          {canEdit && !editMode && (
            <button onClick={enterEditMode} style={{ ...S.btnAmber, padding: "8px 16px", fontSize: 13 }}>
              âœ Editar OT
            </button>
          )}
          {editMode && (
            <button onClick={() => setEditMode(false)} style={{ ...S.btnGhost, padding: "8px 16px", fontSize: 13 }}>
              Cancelar ediciÃ³n
            </button>
          )}
        </div>

        {/* Encabezado OT */}
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Encabezado</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
            <div>
              <span style={S.label}>Ãrea</span>
              <p style={{ fontSize: 14, color: "#1e293b" }}>{ot.areaCodigo} â€” {areaNombre(ot.areaCodigo)}</p>
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
              <span style={S.label}>TÃ©cnico(s)</span>
              {editMode ? (
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {editTecnicos.map((t, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#dbeafe", color: "#1d4ed8", borderRadius: 6, padding: "3px 10px", fontSize: 13, fontWeight: 600 }}>
                        {t.nombreCompleto}
                        <button type="button" onClick={() => setEditTecnicos(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#1d4ed8", fontWeight: 800, fontSize: 14, lineHeight: 1, padding: 0 }}>Ã—</button>
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
                    <option value="">+ Agregar tÃ©cnicoâ€¦</option>
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
              <span style={S.label}>NÂ° OT JDE / OPEPLANT</span>
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

        {/* Equipos â€” modo lectura */}
        {!editMode && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>
              Equipos intervenidos ({ot.lineas.length})
            </div>
            {ot.lineas.map((l, i) => (
              <div key={i} style={{ borderLeft: `3px solid ${TIPO_COLOR[l.tipoOT] ?? "#e2e8f0"}`, paddingLeft: 12, marginBottom: i < ot.lineas.length - 1 ? 14 : 0, paddingBottom: i < ot.lineas.length - 1 ? 14 : 0, borderBottom: i < ot.lineas.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontWeight: 800, fontSize: 14 }}>{l.tag}</span>
                  <span style={S.badge(TIPO_COLOR[l.tipoOT] ?? "#64748b")}>{l.tipoOT}</span>
                </div>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{l.descripcionEquipo}</p>
                {l.sintoma && <p style={{ fontSize: 12, color: "#475569" }}>SÃ­ntoma: {l.sintoma}</p>}
                {l.causaProbable && <p style={{ fontSize: 12, color: "#475569" }}>Causa: {l.causaProbable}</p>}
                {l.resolucionAplicada && <p style={{ fontSize: 12, color: "#475569" }}>ResoluciÃ³n: {l.resolucionAplicada}</p>}
                {l.descripcionTrabajo && <p style={{ fontSize: 12, color: "#475569" }}>{l.descripcionTrabajo}</p>}
                {l.tareasEjecutadas && l.tareasEjecutadas.length > 0 && (
                  <ul style={{ margin: "4px 0", paddingLeft: 16 }}>{l.tareasEjecutadas.map((t, ti) => <li key={ti} style={{ fontSize: 12, color: "#64748b" }}>{t}</li>)}</ul>
                )}
                {(l.tiempoEstimadoHrs || l.tiempoRealHrs) && (
                  <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
                    {l.tiempoEstimadoHrs && <span style={{ fontSize: 12, color: "#94a3b8" }}>Est: {l.tiempoEstimadoHrs}HH</span>}
                    {l.tiempoRealHrs && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>Real: {l.tiempoRealHrs}HH</span>}
                  </div>
                )}
                {l.observaciones && <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 2 }}>{l.observaciones}</p>}

                {l.inspeccion && (["PMP", "PMT", "PTJ"].includes(l.tipoOT)) && (
                  <div style={{ marginTop: 8, background: "#f0fdff", border: "1px solid #a5f3fc", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, fontSize: 11, color: "#0891b2", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                      InspecciÃ³n: {l.inspeccion.checklistNombre}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {l.inspeccion.items.map((it, ii) => (
                        <div key={ii} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                          <span style={{ color: it.ok ? "#0891b2" : "#94a3b8", fontWeight: 800, flexShrink: 0 }}>{it.ok ? "âœ“" : "â—‹"}</span>
                          <span style={{ color: it.ok ? "#0f172a" : "#64748b", textDecoration: it.ok ? "none" : "none", flex: 1 }}>
                            {it.descripcion}
                            {it.obs && <span style={{ color: "#94a3b8", fontStyle: "italic" }}> â€” {it.obs}</span>}
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
                          : <span style={{ fontSize: 18 }}>ðŸ“„</span>
                        }
                        <div>
                          <div style={{ fontWeight: 600, color: "#374151" }}>{adj.nombre}</div>
                          {adj.comentario && <div style={{ color: "#94a3b8" }}>{adj.comentario}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* BotÃ³n agregar evidencia â€” supervisores y admins en cualquier estado */}
                {(esSup || esAdmin) && !isConcluido && (
                  <button
                    onClick={() => {
                      setEvidenciaModal({ lineaTag: l.tag, lineaTipoOT: l.tipoOT });
                      setEvidenciaComentario("");
                      setEvidenciaPreview(null);
                    }}
                    style={{ marginTop: 8, background: "none", border: "1px dashed #94a3b8", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    ðŸ“· Agregar evidencia
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Equipos â€” modo ediciÃ³n con trazabilidad */}
        {editMode && (
          <div style={{ ...S.card, border: "2px solid #f59e0b", background: "#fffbeb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>âœ EdiciÃ³n con Trazabilidad</div>
                <p style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>Cada cambio queda registrado en el historial con fecha y autor.</p>
              </div>
            </div>
            {editLineas.map((l, i) => {
              const hasChecklist = ["PMP", "PMT", "PTJ"].includes(l.tipoOT);
              const isCorrectivo = ["CMP", "CMR"].includes(l.tipoOT);
              const insp = l.inspeccion ?? (hasChecklist ? { checklistId: "", checklistNombre: "Checklist supervisiÃ³n", items: [] } : null);
              return (
                <div key={i} style={{ borderLeft: `3px solid ${TIPO_COLOR[l.tipoOT] ?? "#e2e8f0"}`, paddingLeft: 12, marginBottom: i < editLineas.length - 1 ? 20 : 0, paddingBottom: i < editLineas.length - 1 ? 20 : 0, borderBottom: i < editLineas.length - 1 ? "1px solid #fde68a" : "none" }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{l.tag}</span>
                    <span style={S.badge(TIPO_COLOR[l.tipoOT] ?? "#64748b")}>{l.tipoOT}</span>
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
                      <label style={{ ...S.label, marginBottom: 3 }}>HH Trabajadas <span style={{ fontWeight: 400, textTransform: "none" as const }}>(personas Ã— horas)</span></label>
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

                  {/* SÃ­ntoma / Causa / ResoluciÃ³n â€” CMP y CMR (correctivos) */}
                  {isCorrectivo && (
                    <>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ ...S.label, marginBottom: 3 }}>SÃ­ntoma</label>
                        <textarea value={l.sintoma ?? ""} onChange={(e) => patchLinea(i, { sintoma: e.target.value })} style={S.textareaSm} />
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ ...S.label, marginBottom: 3 }}>Causa probable</label>
                        <textarea value={l.causaProbable ?? ""} onChange={(e) => patchLinea(i, { causaProbable: e.target.value })} style={S.textareaSm} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ ...S.label, marginBottom: 3 }}>ResoluciÃ³n aplicada</label>
                        <textarea value={l.resolucionAplicada ?? ""} onChange={(e) => patchLinea(i, { resolucionAplicada: e.target.value })} style={S.textareaSm} />
                      </div>
                    </>
                  )}

                  {/* Checklist â€” CMP, PMP, PTJ */}
                  {hasChecklist && insp && (
                    <div style={{ marginBottom: 12, background: "#f0fdff", border: "1px solid #a5f3fc", borderRadius: 10, padding: "12px 14px" }}>
                      <label style={{ ...S.label, marginBottom: 8, color: "#0891b2" }}>
                        Checklist â€” {insp.checklistNombre || "sin nombre"}
                      </label>

                      {/* Ãtems existentes */}
                      {insp.items.length === 0 && (
                        <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 8 }}>
                          Sin Ã­tems aÃºn. Agregue uno abajo.
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
                              >âœ•</button>
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

                      {/* Agregar Ã­tem nuevo */}
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          value={itemCheckInputs[i] ?? ""}
                          onChange={(e) => setItemCheckInputs((ts) => ts.map((t, ii) => (ii === i ? e.target.value : t)))}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItemChecklist(i); } }}
                          placeholder="Nuevo Ã­tem del checklistâ€¦"
                          style={{ ...S.input, fontSize: 12, padding: "6px 10px" }}
                        />
                        <button
                          type="button"
                          onClick={() => addItemChecklist(i)}
                          style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" as const, borderColor: "#a5f3fc", color: "#0891b2" }}
                        >+ Ãtem</button>
                      </div>
                    </div>
                  )}

                  {/* Tareas â€” PMP, PMT, PTJ */}
                  {hasChecklist && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ ...S.label, marginBottom: 6 }}>Tareas</label>
                      {(l.tareasEjecutadas ?? []).map((t, ti) => (
                        <div key={ti} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                          <span style={{ flex: 1, fontSize: 13, color: "#1e293b", background: "#f8fafc", borderRadius: 6, padding: "5px 9px" }}>{t}</span>
                          <button type="button" onClick={() => removeTareaLinea(i, ti)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>âœ•</button>
                        </div>
                      ))}
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <input
                          value={tareaInputs[i] ?? ""}
                          onChange={(e) => setTareaInputs((ts) => ts.map((t, ii) => (ii === i ? e.target.value : t)))}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTareaLinea(i); } }}
                          placeholder="Nueva tareaâ€¦"
                          style={{ ...S.input, fontSize: 13, padding: "6px 10px" }}
                        />
                        <button type="button" onClick={() => addTareaLinea(i)} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" as const }}>+ Tarea</button>
                      </div>
                    </div>
                  )}

                  {/* Observaciones â€” siempre */}
                  <div>
                    <label style={{ ...S.label, marginBottom: 3 }}>Observaciones</label>
                    <textarea
                      value={l.observaciones ?? ""}
                      onChange={(e) => patchLinea(i, { observaciones: e.target.value })}
                      placeholder="ObservaciÃ³n adicional (opcional)"
                      style={{ ...S.textareaSm, minHeight: 40 }}
                    />
                  </div>
                </div>
              );
            })}
            {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>âš  {saveErr}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setEditMode(false)} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }}>Cancelar</button>
              <button onClick={saveEdit} disabled={saving} style={{ ...S.btnAmber, padding: "8px 18px", fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Guardandoâ€¦" : "Guardar cambios con trazabilidad"}
              </button>
            </div>
          </div>
        )}

        {/* SupervisiÃ³n editable */}
        {showSupForm && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 14 }}>Datos de SupervisiÃ³n</div>

            {/* Preventivos: Genera OT de Hallazgo */}
            {!hasReactivas && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Â¿Genera OT de Hallazgo?</label>
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
                        {val ? "SÃ­" : "No"}
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
                      placeholder="NÃºmero de OT generada"
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

            {/* Comentarios del supervisor â€” mÃºltiples */}
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
                    style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 15, paddingTop: 4 }}>âœ•</button>
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
                  placeholder="Agregar comentario â€” Enter para confirmar"
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

        {/* SupervisiÃ³n solo lectura */}
        {showSupReadonly && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847", marginBottom: 12 }}>Datos de SupervisiÃ³n</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ot.datosSupervision.requierePlanificacion && (
                <div><span style={S.label}>Requiere WR</span><p style={{ fontSize: 13 }}>SÃ­</p></div>
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
            {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>âš  {saveErr}</p>}
            {bloqueoCierreSemanal && enEstadoTecnico && (
              <p style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
                â³ Esta OT es del plan semanal. El envÃ­o a revisiÃ³n se habilita el <strong>domingo</strong> al finalizar la semana.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canSendToReview && (
                <button onClick={() => cambiarEstado("pendiente_revision", "OT enviada a revisiÃ³n por " + (user?.nombre ?? "tÃ©cnico"))} disabled={saving} style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Guardandoâ€¦" : "Enviar a revisiÃ³n â†‘"}
                </button>
              )}
              {canRevisar && (
                <>
                  <button onClick={() => cambiarEstado("solicitar_correccion", "Supervisor solicitÃ³ correcciÃ³n")} disabled={saving} style={{ ...S.btnRed, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Guardandoâ€¦" : "Solicitar correcciÃ³n"}
                  </button>
                  <button onClick={() => cambiarEstado("revisado", "OT aprobada por " + (user?.nombre ?? "supervisor"))} disabled={saving} style={{ ...S.btnGreen, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Guardandoâ€¦" : "Aprobar OT âœ“"}
                  </button>
                </>
              )}
              {canConcluir && (
                <button onClick={() => cambiarEstado("concluido", "OT concluida y cerrada")} disabled={saving} style={{ ...S.btnGreen, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Guardandoâ€¦" : "Concluir OT âœ“"}
                </button>
              )}
            </div>
          </div>
        )}

        {(isConcluido || (esSup && ot.estado === "revisado")) && (
          <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ fontSize: 13, color: "#15803d", fontWeight: 600, margin: 0 }}>
              {isConcluido ? "OT concluida â€” solo lectura." : "OT revisada â€” lista para concluir."}
            </p>
            <button
              onClick={async () => {
                // Para OTs de plan con nÃºmero JDE, fusionar datos de todos los registros
                // del mismo otJdeNumero+programacionSemanalId antes de generar el PDF
                // Recargar OT actual fresca para garantizar que adjuntos estÃ©n completos
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
                      // Fusionar tÃ©cnicos sin duplicar por nombre
                      const nombresYa = new Set(otBase.tecnicos.map(t => t.nombreCompleto));
                      const tecnicosMerged = [
                        ...otBase.tecnicos,
                        ...mismos.flatMap(h => h.tecnicos).filter(t => !nombresYa.has(t.nombreCompleto)),
                      ];
                      // Fusionar registrosDiarios ordenados por fecha
                      const diariosMerged = [
                        ...(otBase.registrosDiarios ?? []),
                        ...mismos.flatMap(h => h.registrosDiarios ?? []),
                      ].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
                      // Fusionar lineas: misma tag+tipoOT â†’ combinar adjuntos, tareas y observaciones
                      const lineasMap = new Map(otBase.lineas.map(l => [`${l.tag}::${l.tipoOT}`, { ...l, adjuntos: [...(l.adjuntos ?? [])] }]));
                      for (const h of mismos) {
                        for (const l of h.lineas) {
                          const key = `${l.tag}::${l.tipoOT}`;
                          const existing = lineasMap.get(key);
                          if (existing) {
                            const adjNombres = new Set((existing.adjuntos ?? []).map(a => a.nombre));
                            for (const adj of (l.adjuntos ?? [])) {
                              if (!adjNombres.has(adj.nombre)) {
                                existing.adjuntos.push(adj);
                                adjNombres.add(adj.nombre);
                              }
                            }
                            const tareasSet = new Set(existing.tareasEjecutadas ?? []);
                            for (const t of (l.tareasEjecutadas ?? [])) tareasSet.add(t);
                            existing.tareasEjecutadas = Array.from(tareasSet);
                          } else {
                            lineasMap.set(key, { ...l, adjuntos: [...(l.adjuntos ?? [])] });
                          }
                        }
                      }
                      const lineasMerged = Array.from(lineasMap.values());
                      otParaPDF = { ...otBase, tecnicos: tecnicosMerged, registrosDiarios: diariosMerged, lineas: lineasMerged };
                    }
                  } catch { /* usa otBase sin fusiÃ³n si falla el fetch */ }

                  // Sobrescribir tiempoEstimadoHrs con el total del plan semanal
                  // (suma de hhTotal de todas las OtProgramadas con el mismo numeroOT en la semana)
                  if (otBase.programacionSemanalId && otBase.otJdeNumero) {
                    try {
                      const plan = await fetch(`/api/programacion-semanal/${otBase.programacionSemanalId}`).then(r => r.json());
                      const otsDelPlan: { numeroOT: string; hhTotal: number }[] = plan?.otsProgramadas ?? [];
                      const hhEstPlan = otsDelPlan
                        .filter(o => o.numeroOT === otBase.otJdeNumero)
                        .reduce((s, o) => s + (o.hhTotal ?? 0), 0);
                      if (hhEstPlan > 0) {
                        otParaPDF = {
                          ...otParaPDF,
                          lineas: otParaPDF.lineas.map(l => ({ ...l, tiempoEstimadoHrs: hhEstPlan })),
                        };
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

        {/* â”€â”€ Avances Diarios (OTs multi-dÃ­a del plan) â”€â”€ */}
        {ot.origenPlan && (() => {
          const hhLineas = ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
          const diasLineas = hhLineas > 0 ? 1 : 0;
          const hhDiarios = (ot.registrosDiarios ?? []).reduce((s, r) => s + r.hhTrabajadas, 0);
          const diasDiarios = ot.registrosDiarios?.length ?? 0;
          const totalDias = diasLineas + diasDiarios;
          const totalHH = hhLineas + hhDiarios;
          const puedeAgregarAvance = !["pendiente_revision", "revisado", "concluido"].includes(ot.estado);
          return (
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>
                  Avances diarios
                  {totalDias > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "2px 7px" }}>
                      {totalDias} dÃ­a{totalDias !== 1 ? "s" : ""} Â· {totalHH}HH acumuladas
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Registro de trabajo por dÃ­a para esta OT del plan</p>
              </div>
              {puedeAgregarAvance && (esTecnico || esAdmin) && !showAvance && (
                <button
                  onClick={() => setShowAvance(true)}
                  style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  + Agregar avance del dÃ­a
                </button>
              )}
            </div>

            {/* Formulario de nuevo avance */}
            {showAvance && (
              <div style={{ background: "#eff6ff", border: "2px solid #bfdbfe", borderRadius: 10, padding: "14px", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1d4ed8", marginBottom: 12 }}>Avance del dÃ­a</div>
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

                {/* Tareas del dÃ­a */}
                <div style={{ marginBottom: 10 }}>
                  <label style={S.label}>Tareas ejecutadas hoy</label>
                  {avanceForm.tareasEjecutadas.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ flex: 1, fontSize: 13, background: "white", borderRadius: 6, padding: "5px 9px", border: "1px solid #e2e8f0" }}>{t}</span>
                      <button type="button"
                        onClick={() => setAvanceForm(f => ({ ...f, tareasEjecutadas: f.tareasEjecutadas.filter((_, j) => j !== i) }))}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>âœ•</button>
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
                      placeholder="Describir tarea y presionar Enterâ€¦"
                      style={{ ...S.input, fontSize: 13 }} />
                    <button type="button"
                      onClick={() => { if (avanceTareaInput.trim()) { setAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, avanceTareaInput.trim()] })); setAvanceTareaInput(""); } }}
                      style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap" as const }}>+ Tarea</button>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Observaciones</label>
                  <textarea value={avanceForm.observaciones}
                    onChange={e => setAvanceForm(f => ({ ...f, observaciones: e.target.value }))}
                    placeholder="Estado del trabajo, materiales usados, pendientesâ€¦"
                    style={{ ...S.textarea, minHeight: 52 }} />
                </div>

                {saveErr && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>âš  {saveErr}</p>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => { setShowAvance(false); setSaveErr(""); }} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 13 }}>Cancelar</button>
                  <button onClick={guardarAvance} disabled={saving} style={{ ...S.btnGreen, padding: "8px 18px", fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                    {saving ? "Guardandoâ€¦" : "Guardar avance"}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de avances existentes */}
            {(ot.registrosDiarios?.length ?? 0) === 0 && !showAvance ? (
              <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Sin avances registrados aÃºn. El tÃ©cnico debe agregar el trabajo de cada dÃ­a.</p>
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
                        {esSup && r._id && !isEditing && (
                          <button
                            onClick={() => {
                              setEditingAvanceId(r._id!);
                              setEditAvanceForm({ hhTrabajadas: r.hhTrabajadas, tareasEjecutadas: [...r.tareasEjecutadas], observaciones: r.observaciones ?? "", tareaInput: "" });
                            }}
                            style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                            title="Editar este avance">
                            âœ
                          </button>
                        )}
                        {esSup && r._id && !isEditing && (
                          <button
                            onClick={() => setDeletingAvanceId(r._id!)}
                            style={{ background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                            title="Eliminar este avance">
                            âœ•
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Formulario de ediciÃ³n inline */}
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
                          <div>
                            <label style={S.label}>HH trabajadas</label>
                            <input type="number" min="0" step="0.5"
                              value={editAvanceForm.hhTrabajadas || ""}
                              onChange={e => setEditAvanceForm(f => ({ ...f, hhTrabajadas: Number(e.target.value) }))}
                              style={S.input} />
                          </div>
                          <div>
                            <label style={S.label}>Observaciones</label>
                            <input type="text"
                              value={editAvanceForm.observaciones}
                              onChange={e => setEditAvanceForm(f => ({ ...f, observaciones: e.target.value }))}
                              placeholder="Observaciones del dÃ­aâ€¦"
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
                                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>âœ•</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 6 }}>
                            <input value={editAvanceForm.tareaInput}
                              onChange={e => setEditAvanceForm(f => ({ ...f, tareaInput: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter" && editAvanceForm.tareaInput.trim()) { e.preventDefault(); setEditAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, f.tareaInput.trim()], tareaInput: "" })); } }}
                              placeholder="Nueva tarea â€” Enter para agregar"
                              style={{ ...S.input, fontSize: 12 }} />
                            <button type="button"
                              onClick={() => { if (editAvanceForm.tareaInput.trim()) setEditAvanceForm(f => ({ ...f, tareasEjecutadas: [...f.tareasEjecutadas, f.tareaInput.trim()], tareaInput: "" })); }}
                              style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" as const }}>+ Tarea</button>
                          </div>
                        </div>
                        {saveErr && <p style={{ color: "#dc2626", fontSize: 12 }}>âš  {saveErr}</p>}
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button onClick={() => { setEditingAvanceId(null); setSaveErr(""); }} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}>Cancelar</button>
                          <button onClick={guardarEdicionAvance} disabled={saving} style={{ ...S.btnAmber, padding: "6px 14px", fontSize: 12, opacity: saving ? 0.6 : 1 }}>
                            {saving ? "Guardandoâ€¦" : "Guardar cambios"}
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
                      </>
                    )}
                  </div>
                  );
                })}
                {/* Totales */}
                {totalDias > 1 && (
                  <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 14px", display: "flex", gap: 24 }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>Total dÃ­as</span>
                      <p style={{ fontSize: 16, fontWeight: 800, color: "#0369a1" }}>{totalDias}</p>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>HH acumuladas</span>
                      <p style={{ fontSize: 16, fontWeight: 800, color: "#0369a1" }}>{totalHH}HH</p>
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>TÃ©cnicos</span>
                      <p style={{ fontSize: 12, color: "#0369a1" }}>{[...new Set(ot.tecnicos.map(t => t.nombreCompleto).concat((ot.registrosDiarios ?? []).map(r => r.tecnico)))].join(", ")}</p>
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
                  <p style={{ fontSize: 11, color: "#94a3b8" }}>{c.nombreUsuario} Â· {new Date(c.fechaHora).toLocaleString("es-BO")}</p>
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
            {evidenciaModal.lineaTag} Â· {evidenciaModal.lineaTipoOT}
          </p>

          {/* Preview de la imagen seleccionada */}
          {evidenciaPreview ? (
            <div style={{ marginBottom: 14, position: "relative" }}>
              {evidenciaPreview.tipo === "foto"
                ? <img src={evidenciaPreview.dataUrl} alt={evidenciaPreview.nombre} style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, border: "1px solid #e2e8f0" }} />
                : <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, textAlign: "center" as const }}>ðŸ“„ {evidenciaPreview.nombre}</div>
              }
              <button
                onClick={() => { setEvidenciaPreview(null); }}
                style={{ position: "absolute", top: 6, right: 6, background: "#dc2626", color: "white", border: "none", borderRadius: "50%", width: 22, height: 22, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >âœ•</button>
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
                ðŸ“· Seleccionar foto o documento
              </button>
            </div>
          )}

          {/* Comentario */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>Comentario / descripciÃ³n</label>
            <input
              value={evidenciaComentario}
              onChange={e => setEvidenciaComentario(e.target.value)}
              placeholder="Ej: Estado del equipo al momento de la intervenciÃ³n"
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
                      cambio: `Evidencia aÃ±adida en ${evidenciaModal.lineaTag} por ${user?.nombre ?? "supervisor"}`,
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
              {evidenciaSaving ? "Guardandoâ€¦" : "Guardar evidencia"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal confirmaciÃ³n eliminar */}
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
            Esta acciÃ³n eliminarÃ¡ permanentemente la OT y todos sus datos (lÃ­neas, tÃ©cnicos, historial). No se puede deshacer.
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
    {/* Modal confirmaciÃ³n eliminar avance diario */}
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
            Se eliminarÃ¡ este registro de avance. Esta acciÃ³n no se puede deshacer.
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
