"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { getFechaTurno, localDateStr, autoTurno, estaEnVentanaCierreSemanal } from "@/lib/turno";
import { getWeekNumber, getWeekDates, getSemanaAnioOffset } from "@/lib/semana";

// ─── Types ────────────────────────────────────────────────────────────────────

type TurnoTipo = "Diurno" | "Nocturno" | "Parada de Planta" | "Planta" | "Otro";
type TipoOT = "CMP" | "CMR" | "PMP" | "PMT" | "PDM" | "PTJ";
type DiaSem = "Lu" | "Ma" | "Mi" | "Ju" | "Vi" | "Sa" | "Do";

type AreaOption = { codigo: string; nombre: string };
type EquipoResult = { tag: string; descripcion: string; tipoEquipo: string; descripcionTipo?: string; categoriaISO?: string | null; areaCodigo: string; descripcionArea?: string; nivel?: number; criticidad?: string };
type ModoEntry  = { codigoModo?: string; sintoma: string };
type FaultEntry = { codigoCausa?: string; causaProbable: string; resolucionSugerida: string; tiempoEstimadoHrs: number };
type SentidoInspeccion = "Visual" | "Auditivo" | "Tactil" | "Olfativo" | "Instrumental";
const SENTIDO_META: Record<SentidoInspeccion, { emoji: string; color: string; label: string }> = {
  Visual:       { emoji: "👁️",  color: "#2563eb", label: "Visual" },
  Auditivo:     { emoji: "👂",  color: "#0891b2", label: "Auditivo" },
  Tactil:       { emoji: "✋",  color: "#d97706", label: "Táctil" },
  Olfativo:     { emoji: "👃",  color: "#7c3aed", label: "Olfativo" },
  Instrumental: { emoji: "📏",  color: "#16a34a", label: "Instrumental" },
};
type ChecklistItem = { _id: string; nombre: string; disciplina: string; nivelTag: number | null; areaProceso: string; items: { descripcion: string; orden: number; sentido?: SentidoInspeccion }[] };
type InspeccionEntry = { checklistId: string; checklistNombre: string; items: { descripcion: string; sentido?: SentidoInspeccion; ok: boolean; obs: string }[] };

type AdjuntoItem = {
  id: string;
  tipo: "foto" | "documento";
  nombre: string;
  dataUrl: string;
  comentario: string;          // comentario principal obligatorio
  comentariosExtra: string[];  // comentarios adicionales
};

type LineaForm = {
  id: string;
  tag: string; descripcionEquipo: string; tipoEquipo: string; categoriaISO: string; criticidad: string;
  nivel: number; disciplina: string; areaProceso: string;
  tipoOT: TipoOT | "";
  sintoma: string; causaProbable: string; resolucionAplicada: string;
  estadoFinal: EstadoFinal | "";
  tiempoEstimadoHrs: string; tiempoRealHrs: string;
  descripcionTrabajo: string; tareasEjecutadas: string[];
  inspeccion: InspeccionEntry | null;
  observaciones: string;
  adjuntos: AdjuntoItem[];
};

type EstadoFinal = "operativo" | "operativo_obs" | "pendiente" | "fuera_servicio";
const ESTADO_FINAL_OPTIONS: { value: EstadoFinal; label: string; color: string }[] = [
  { value: "operativo",      label: "Operativo",              color: "#16a34a" },
  { value: "operativo_obs",  label: "Operativo c/ observación", color: "#d97706" },
  { value: "pendiente",      label: "Pendiente",              color: "#2563eb" },
  { value: "fuera_servicio", label: "Fuera de servicio",      color: "#dc2626" },
];

// Detecta la disciplina usando todas las fuentes disponibles
const CATS_ELECTRICAS = ["MOTORES", "TABLEROS", "GENERADORES", "TRANSFORMADORES", "VARIADORES DE FREC"];
// Códigos JDE que son eléctricos — fuente independiente de categoriaISO
const TIPOS_JDE_ELECTRICOS = new Set(["EMT", "MIL", "AEM", "PGC", "PTF", "TRF", "PSW", "SWT", "PWB"]);
const RE_DESC_ELECTRICO = /motor|variador|transformador|generador|tablero|vfd|arrancador|switchgear/i;

function detectarDisciplina(tag: string, categoriaISO?: string | null, tipoEquipo?: string, descripcionTipo?: string): string {
  // TAG con prefijo de letras → Instrumentación (ISA 5.1)
  if (/^[A-Z]{2,}/.test(tag)) return "Instrumentacion";
  // Fuente 1: categoriaISO (cuando llega)
  if (categoriaISO && CATS_ELECTRICAS.includes(categoriaISO)) return "Electrico";
  // Fuente 2: código JDE directo
  if (tipoEquipo && TIPOS_JDE_ELECTRICOS.has(tipoEquipo)) return "Electrico";
  // Fuente 3: descripción del tipo (ej. "Motor Eléctrico", "Transformador de Energía")
  if (descripcionTipo && RE_DESC_ELECTRICO.test(descripcionTipo)) return "Electrico";
  return "Mecanico";
}

// Deriva categoriaISO desde tipoEquipo JDE cuando la BD no la devuelve
const MAPEO_JDE_CAT: Record<string, string> = {
  EMT: "MOTORES", MIL: "MOTORES", AEM: "VARIADORES DE FREC",
  PTF: "TRANSFORMADORES", TRF: "TRANSFORMADORES",
  PGC: "GENERADORES", PMP: "BOMBAS", VLV: "VALVULAS",
  CMP: "COMPRESORES", TPM: "CAJAS ENGR", HDS: "SIST HIDRÁULICOS",
  LBS: "SIST LUBRICACIÓN", SLC: "CINTAS", TNS: "TANQUES",
  SNT: "SENSORES", HLE: "PUENTES GRUA", HTE: "INTERCAMBIADORES",
};
function derivarCategoriaISO(categoriaISO: string | null | undefined, tipoEquipo?: string): string {
  if (categoriaISO) return categoriaISO;
  return (tipoEquipo && MAPEO_JDE_CAT[tipoEquipo]) ?? "";
}

// Normaliza el área de proceso desde descripcionArea
function detectarAreaProceso(descripcionArea?: string): string {
  const d = (descripcionArea ?? "").toLowerCase();
  if (d.includes("chanc")) return "chancado";
  if (d.includes("moli")) return "molienda";
  if (d.includes("flot")) return "flotacion";
  if (d.includes("filtro")) return "filtros";
  if (d.includes("agua")) return "aguas";
  return "general";
}

type BitacoraEntry = { turno: string; supervisor: string; nota: string; hhAtendidas: number; fecha?: string };

type OTDetalle = {
  _id: string; numeroOT: string; estado: string; turno: string;
  tecnicos: { nombreCompleto: string }[];
  lineas: { tag: string; tipoOT: string; descripcionEquipo?: string; sintoma?: string; resolucionAplicada?: string; estadoFinal?: string; descripcionTrabajo?: string; tiempoRealHrs?: number }[];
};

type OTPlan = {
  numeroOT: string; tipoOT: string; tipoTrabajo: string;
  descripcion: string; tag: string; descripcionEquipo?: string;
  hhTotal?: number; personas?: number; grupo: string; dia: DiaSem; estado: string;
  personalAsignado: string[];
  personalAsignadoIds?: string[];
  ordenTrabajoId?: string; ordenTrabajoNum?: string;
  pasarNoche?: boolean; pasarNocheMotivo?: string; pasarNocheNota?: string; pasarNochePor?: string;
  esGuardia?: boolean;
  bitacora?: BitacoraEntry[];
};

type PlanDoc = {
  _id: string; semana: number; anio: number; disciplina: string;
  areaCodigo?: string; otsProgramadas: OTPlan[];
};

type PlanRef = { planId: string; areaCodigo: string; ot: OTPlan };

type FormData = {
  fecha: string; turno: TurnoTipo | ""; areaCodigo: string;
  tecnicos: { usuarioId: string; nombreCompleto: string }[];
  lineas: LineaForm[];
  programacionSemanalId: string; otJdeNumero: string; otJdeDia: string; origenPlan: boolean;
  esRecurrente: boolean; // OT que aparece en múltiples días de la semana
};

type AvanceDiarioForm = {
  fecha: string;
  hhTrabajadas: string;
  tareas: string[];
  tareaInput: string;
  observaciones: string;
  adjuntos: AdjuntoItem[];
};

// ─── Date/Helpers ─────────────────────────────────────────────────────────────

const DIA_MAP: DiaSem[] = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

// Compara nombre del plan vs nombre de sesión tolerando orden de palabras diferente.
// Compara nombres normalizando acentos y requiriendo ≥2 tokens en común.
// "James Quispe" vs "Quispe Valda José Calasanz" → 1 token común → false ✓
// "José Quispe"  vs "Quispe Valda José Calasanz" → 2 tokens comunes → true ✓
function normalizar(s: string): string {
  return s.trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
// Distancia de edición ≤ 1 para tolerar typos de 1 carácter (ej: "Altamirando" vs "Altamirano")
function editDist1(a: string, b: string): boolean {
  if (a === b) return true;
  const d = Math.abs(a.length - b.length);
  if (d > 1) return false;
  let diff = 0;
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== b[j]) {
      if (++diff > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    } else { i++; j++; }
  }
  return true;
}
function nombreCoincide(planNombre: string, userNombre: string): boolean {
  const normA = normalizar(planNombre);
  const normB = normalizar(userNombre);
  if (normA === normB || normA.includes(normB) || normB.includes(normA)) return true;
  const tokA = normA.split(" ").filter(t => t.length > 2);
  const tokB = normB.split(" ").filter(t => t.length > 2);
  const [menor, mayor] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
  if (menor.length === 0) return false;
  // Cada token del nombre más corto debe tener un par en el más largo con dist ≤ 1
  for (const t of menor) {
    if (!mayor.some(m => editDist1(t, m))) return false;
  }
  return true;
}

const TIPOS_OT: { value: TipoOT; label: string; desc: string; color: string }[] = [
  { value: "CMP", label: "CMP", desc: "Correctivo Mayor Programado", color: "#dc2626" },
  { value: "CMR", label: "CMR", desc: "Correctivo Menor Rutinario", color: "#d97706" },
  { value: "PMP", label: "PMP", desc: "Preventivo Mayor Programado", color: "#2563eb" },
  { value: "PMT", label: "PMT", desc: "Preventivo Menor de Turno", color: "#0891b2" },
  { value: "PDM", label: "PDM", desc: "Mantenimiento Predictivo", color: "#059669" },
  { value: "PTJ", label: "PTJ", desc: "Proyecto / Trab. de Ingeniería", color: "#7c3aed" },
];

const TURNOS: TurnoTipo[] = ["Diurno", "Nocturno", "Parada de Planta", "Planta", "Otro"];
const isCorrectivo = (t: TipoOT | "") => t === "CMP" || t === "CMR";
const isPreventivo = (t: TipoOT | "") => t === "PMP" || t === "PMT" || t === "PDM" || t === "PTJ";

const TIPO_COLOR: Record<TipoOT, string> = { CMP: "#dc2626", CMR: "#d97706", PMP: "#2563eb", PMT: "#0891b2", PDM: "#059669", PTJ: "#7c3aed" };
const CRIT_COLOR: Record<string, string> = { A: "#dc2626", B: "#d97706", C: "#16a34a" };
const ESTADO_BG: Record<string, string> = {
  no_iniciada: "#f1f5f9", en_proceso: "#eff6ff", en_revision: "#fffbeb",
  completada: "#f0fdf4", cancelada: "#fef2f2", atrasada: "#fef2f2", bloqueada: "#faf5ff",
};
const ESTADO_CLR: Record<string, string> = {
  no_iniciada: "#64748b", en_proceso: "#2563eb", en_revision: "#d97706",
  completada: "#16a34a", cancelada: "#dc2626", atrasada: "#dc2626", bloqueada: "#7c3aed",
};

function newLinea(): LineaForm {
  return {
    id: Math.random().toString(36).slice(2),
    tag: "", descripcionEquipo: "", tipoEquipo: "", categoriaISO: "", criticidad: "",
    nivel: 0, disciplina: "", areaProceso: "", tipoOT: "",
    sintoma: "", causaProbable: "", resolucionAplicada: "", estadoFinal: "", tiempoEstimadoHrs: "", tiempoRealHrs: "",
    descripcionTrabajo: "", tareasEjecutadas: [], inspeccion: null, observaciones: "", adjuntos: [],
  };
}

// Comprime imagen via Canvas a max 1024px y calidad 0.75
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

async function leerDocumento(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target!.result as string);
    reader.readAsDataURL(file);
  });
}

function lineaFromPlan(ot: OTPlan): LineaForm {
  const tipoOT = (["CMP","CMR","PMP","PMT","PDM","PTJ"].includes(ot.tipoOT) ? ot.tipoOT : "") as TipoOT | "";
  return {
    ...newLinea(),
    tag: ot.tag,
    descripcionEquipo: ot.descripcionEquipo ?? "",
    tipoOT,
    // Pre-cargar siempre la descripción del plan como detalle de trabajo
    descripcionTrabajo: ot.descripcion ?? "",
    tiempoEstimadoHrs: ot.hhTotal ? String(ot.hhTotal) : "",
    adjuntos: [],
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: { minHeight: "100vh", background: "#f1f5f9" },
  wrap: { maxWidth: 700, margin: "0 auto", padding: "20px 16px 60px" },
  card: { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 12 },
  label: { display: "block" as const, fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 5 },
  input: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white" },
  select: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white", cursor: "pointer" },
  textarea: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 68, background: "white" },
  btnPrimary: (disabled = false) => ({ background: disabled ? "#93c5fd" : "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" as const : "pointer" as const }),
  btnGreen: (disabled = false) => ({ background: disabled ? "#86efac" : "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" as const : "pointer" as const }),
  btnOutline: { background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" as const },
  btnGhost: { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const },
  badge: (color: string) => ({ display: "inline-block" as const, background: color + "18", color, border: `1px solid ${color}35`, borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }),
  err: { color: "#dc2626", fontSize: 12, marginTop: 4 } as React.CSSProperties,
};

// ─── TAG Search ───────────────────────────────────────────────────────────────

function TagSearch({ value, area, onSelect }: { value: string; area: string; onSelect: (eq: EquipoResult) => void }) {
  const [q, setQ] = useState(value);
  const [results, setResults] = useState<EquipoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setQ(value); }, [value]);

  function search(query: string) {
    setLoading(true);
    const p = new URLSearchParams();
    if (query.length >= 2) p.set("q", query);
    if (area) p.set("area", area);
    fetch(`/api/equipos?${p}`)
      .then(r => r.json())
      .then((d: EquipoResult[]) => {
        if (d.length === 0 && area) {
          // fallback: buscar sin filtro de área
          const p2 = new URLSearchParams();
          if (query.length >= 2) p2.set("q", query);
          return fetch(`/api/equipos?${p2}`).then(r => r.json());
        }
        return d;
      })
      .then((d: EquipoResult[]) => { setResults(d); setOpen(d.length > 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input value={q} onChange={e => { setQ(e.target.value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => search(e.target.value), 280); }}
          onFocus={() => results.length > 0 ? setOpen(true) : search(q)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Buscar por TAG o descripción…" style={S.input} />
        {loading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8" }}>…</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.1)", zIndex: 100, overflow: "hidden" }}>
          {results.map(eq => (
            <button key={eq.tag} type="button" onMouseDown={() => { setQ(eq.tag); setOpen(false); onSelect(eq); }}
              style={{ width: "100%", padding: "9px 13px", background: "none", border: "none", borderBottom: "1px solid #f8fafc", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{eq.tag}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{eq.descripcion}</div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {eq.criticidad && <span style={S.badge(CRIT_COLOR[eq.criticidad] ?? "#64748b")}>{eq.criticidad}</span>}
                {eq.tipoEquipo && <span style={S.badge("#64748b")}>{eq.tipoEquipo}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function Steps({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "14px 0 22px" }}>
      {[{ n: 1, l: "Encabezado" }, { n: 2, l: "Trabajo" }, { n: 3, l: "Revisión" }].map((s, i, arr) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: step > s.n ? "#2563eb" : step === s.n ? "#1d4ed8" : "#e2e8f0", color: step >= s.n ? "white" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, boxShadow: step === s.n ? "0 0 0 4px #2563eb25" : "none" }}>
              {step > s.n ? "✓" : s.n}
            </div>
            <span style={{ fontSize: 11, color: step >= s.n ? "#2563eb" : "#94a3b8", fontWeight: 600 }}>{s.l}</span>
          </div>
          {i < arr.length - 1 && <div style={{ width: 56, height: 2, background: step > s.n ? "#2563eb" : "#e2e8f0", margin: "0 4px 16px" }} />}
        </div>
      ))}
    </div>
  );
}

// ─── Técnicos Panel ───────────────────────────────────────────────────────────

function TecnicosPanel({
  areaCodigo, tecnicos, personalAsignadoPlan, onChange, error,
}: {
  areaCodigo: string;
  tecnicos: { usuarioId: string; nombreCompleto: string }[];
  personalAsignadoPlan: string[];
  onChange: (t: { usuarioId: string; nombreCompleto: string }[]) => void;
  error?: string;
}) {
  const [usuarios, setUsuarios] = useState<{ _id: string; nombreCompleto: string }[]>([]);
  const [inputNombre, setInputNombre] = useState("");
  const [showAgregar, setShowAgregar] = useState(false);
  const [showLista, setShowLista] = useState(false);

  useEffect(() => {
    if (!areaCodigo) { setUsuarios([]); return; }
    fetch(`/api/usuarios?rol=4&area=${areaCodigo}`).then(r => r.json()).then(setUsuarios).catch(() => {});
  }, [areaCodigo]);

  function toggleUsuario(u: { _id: string; nombreCompleto: string }) {
    const has = tecnicos.some(t => t.usuarioId === u._id);
    const next = has ? tecnicos.filter(t => t.usuarioId !== u._id) : [...tecnicos, { usuarioId: u._id, nombreCompleto: u.nombreCompleto }];
    onChange(next);
    if (!has) setShowLista(false); // colapsar al seleccionar
  }

  function addFromPlan(nombre: string) {
    if (tecnicos.some(t => t.nombreCompleto.toLowerCase() === nombre.toLowerCase())) return;
    // Si existe en lista de usuarios del área, usar su ID
    const found = usuarios.find(u => u.nombreCompleto.toLowerCase() === nombre.toLowerCase());
    onChange([...tecnicos, { usuarioId: found?._id ?? "", nombreCompleto: found?.nombreCompleto ?? nombre }]);
  }

  function addLibre() {
    const n = inputNombre.trim();
    if (!n) return;
    if (tecnicos.some(t => t.nombreCompleto.toLowerCase() === n.toLowerCase())) { setInputNombre(""); return; }
    const found = usuarios.find(u => u.nombreCompleto.toLowerCase() === n.toLowerCase());
    onChange([...tecnicos, { usuarioId: found?._id ?? "", nombreCompleto: found?.nombreCompleto ?? n }]);
    setInputNombre("");
    setShowAgregar(false);
  }

  function remove(idx: number) {
    onChange(tecnicos.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>
          Técnico(s) a cargo
          {tecnicos.length > 0 && <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 6 }}>({tecnicos.length})</span>}
        </div>
        <button type="button" onClick={() => setShowAgregar(v => !v)}
          style={{ fontSize: 12, color: "#2563eb", background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
          + Agregar por nombre
        </button>
      </div>

      {/* Chips de técnicos seleccionados */}
      {tecnicos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {tecnicos.map((t, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, padding: "4px 10px 4px 12px", fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>
              {t.nombreCompleto}
              <button type="button" onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 14, lineHeight: 1 }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Chips rápidos del plan */}
      {personalAsignadoPlan.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>
            Asignados en el plan
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {personalAsignadoPlan.map((nombre, i) => {
              const yaEsta = tecnicos.some(t => t.nombreCompleto.toLowerCase() === nombre.toLowerCase());
              return (
                <button key={i} type="button" onClick={() => yaEsta ? null : addFromPlan(nombre)}
                  style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: yaEsta ? "default" : "pointer", border: yaEsta ? "1px solid #86efac" : "1px solid #e2e8f0", background: yaEsta ? "#f0fdf4" : "white", color: yaEsta ? "#16a34a" : "#374151", fontWeight: yaEsta ? 700 : 400 }}>
                  {yaEsta ? "✓ " : "+ "}{nombre}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selector de usuarios del área */}
      {usuarios.length > 0 && (
        <div style={{ marginBottom: showLista ? 8 : 0 }}>
          <button type="button" onClick={() => setShowLista(v => !v)}
            style={{ fontSize: 12, color: "#2563eb", background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600, marginBottom: showLista ? 8 : 0 }}>
            {showLista ? "▲ Ocultar técnicos" : `+ Técnicos del área (${usuarios.length})`}
          </button>
          {showLista && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {usuarios.map(u => {
                const sel = tecnicos.some(t => t.usuarioId === u._id);
                return (
                  <label key={u._id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 8, cursor: "pointer", border: sel ? "1px solid #2563eb" : "1px solid #f1f5f9", background: sel ? "#eff6ff" : "#fafafa" }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleUsuario(u)} style={{ width: 14, height: 14, accentColor: "#2563eb" }} />
                    <span style={{ fontSize: 13, fontWeight: sel ? 600 : 400, color: "#1e293b" }}>{u.nombreCompleto}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Input libre para agregar por nombre (contratistas, etc.) */}
      {showAgregar && (
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <input value={inputNombre} onChange={e => setInputNombre(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLibre(); } }}
            placeholder="Nombre del técnico o contratista…"
            style={{ ...S.input, flex: 1, fontSize: 13 }} />
          <button type="button" onClick={addLibre} style={{ ...S.btnPrimary(), padding: "9px 14px", fontSize: 13 }}>Agregar</button>
          <button type="button" onClick={() => setShowAgregar(false)} style={{ ...S.btnGhost, padding: "9px 12px" }}>✕</button>
        </div>
      )}

      {!areaCodigo && tecnicos.length === 0 && (
        <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>Selecciona un área en el encabezado para ver técnicos disponibles.</p>
      )}
      {error && <p style={{ ...S.err, marginTop: 8 }}>{error}</p>}
    </div>
  );
}

// ─── Linea Editor ─────────────────────────────────────────────────────────────

// Verifica si un TAG/nivel/disciplina califica para inspección
function aplicaChecklist(nivel: number, disciplina: string, tipoOT: TipoOT | ""): boolean {
  if (!["PMP", "PMT", "CMP"].includes(tipoOT)) return false;
  // Si nivel no está cargado (0), mostrar igualmente para no bloquear al técnico
  if (nivel === 0 || nivel === 5 || nivel === 6) return true;
  if (disciplina === "Instrumentacion" && nivel === 7) return true;
  return false;
}

// ─── AdjuntoCard ─────────────────────────────────────────────────────────────

function AdjuntoCard({ adj, onChange, onRemove }: {
  adj: AdjuntoItem;
  onChange: (updated: AdjuntoItem) => void;
  onRemove: () => void;
}) {
  const [inputComentario, setInputComentario] = useState("");

  // Todos los comentarios: comentario principal + extras en una sola lista
  const todos = adj.comentario.trim()
    ? [adj.comentario, ...adj.comentariosExtra]
    : adj.comentariosExtra;
  const sinComentario = todos.length === 0;

  function agregar() {
    const txt = inputComentario.trim();
    if (!txt) return;
    if (!adj.comentario.trim()) {
      // El primero se convierte en comentario principal
      onChange({ ...adj, comentario: txt });
    } else {
      onChange({ ...adj, comentariosExtra: [...adj.comentariosExtra, txt] });
    }
    setInputComentario("");
  }

  function eliminarComentario(idx: number) {
    if (idx === 0 && adj.comentario.trim()) {
      // Eliminar el comentario principal: promover el primero de extras
      const [primero, ...resto] = adj.comentariosExtra;
      onChange({ ...adj, comentario: primero ?? "", comentariosExtra: resto });
    } else {
      const extraIdx = idx - (adj.comentario.trim() ? 1 : 0);
      onChange({ ...adj, comentariosExtra: adj.comentariosExtra.filter((_, j) => j !== extraIdx) });
    }
  }

  return (
    <div style={{ background: "#f8fafc", border: sinComentario ? "1px solid #fca5a5" : "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      {/* Fila superior: miniatura + nombre + botón eliminar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
        {adj.tipo === "foto" ? (
          <img src={adj.dataUrl} alt={adj.nombre}
            style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid #e2e8f0" }} />
        ) : (
          <div style={{ width: 52, height: 52, background: "#f1f5f9", borderRadius: 6, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: 20 }}>📄</span>
            <span style={{ fontSize: 9, color: "#64748b" }}>{adj.nombre.split(".").pop()?.toUpperCase()}</span>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{adj.nombre}</div>
          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2, color: adj.tipo === "foto" ? "#2563eb" : "#7c3aed" }}>
            {adj.tipo === "foto" ? "📷 Foto" : "📄 Documento"}
          </div>
        </div>
        <button type="button" onClick={onRemove}
          style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 12, padding: "4px 8px", flexShrink: 0, fontWeight: 700 }}>✕ Eliminar</button>
      </div>

      {/* Lista de comentarios ya agregados */}
      {todos.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", flexDirection: "column" as const, gap: 4 }}>
          {todos.map((c, ci) => (
            <div key={ci} style={{ display: "flex", alignItems: "flex-start", gap: 6, background: "#eff6ff", borderRadius: 6, padding: "6px 10px", border: "1px solid #bfdbfe" }}>
              <span style={{ flex: 1, fontSize: 12, color: "#1e40af", lineHeight: 1.4 }}>• {c}</span>
              <button type="button" onClick={() => eliminarComentario(ci)}
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 13, lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {sinComentario && (
        <p style={{ fontSize: 11, color: "#dc2626", marginBottom: 6 }}>⚠ Agrega al menos un comentario para confirmar</p>
      )}

      {/* Input + Agregar — único punto de entrada, siempre visible */}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={inputComentario}
          onChange={e => setInputComentario(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); agregar(); } }}
          placeholder={sinComentario ? `Comentario sobre ${adj.tipo === "foto" ? "la foto" : "el documento"}…` : "Agregar otro comentario — Enter para confirmar"}
          style={{ ...S.input, fontSize: 12, flex: 1, borderColor: sinComentario ? "#fca5a5" : "#cbd5e1", background: sinComentario ? "#fff5f5" : "white" }}
        />
        <button type="button" onClick={agregar}
          style={{ background: "#0891b2", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" as const }}>
          + Agregar
        </button>
      </div>
    </div>
  );
}

// ─── AvanceDiarioMiniForm ────────────────────────────────────────────────────
// Formulario reutilizable de "avance del día", usado tanto para OTs recurrentes
// del plan semanal como para OTs reactivas (CMR/CMP) que continúan otro día.

function AvanceDiarioMiniForm({
  titulo,
  form,
  onChange,
  cargandoAdj,
  onCargandoAdjChange,
  onCancelar,
  onGuardar,
  guardando,
  accentColor = "#1d4ed8",
}: {
  titulo: string;
  form: AvanceDiarioForm;
  onChange: (updater: (f: AvanceDiarioForm) => AvanceDiarioForm) => void;
  cargandoAdj: boolean;
  onCargandoAdjChange: (v: boolean) => void;
  onCancelar: () => void;
  onGuardar: () => void;
  guardando: boolean;
  accentColor?: string;
}) {
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid #bfdbfe", paddingTop: 10, background: "#f0f7ff", borderRadius: "0 0 10px 10px", padding: "10px 12px" }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: accentColor, marginBottom: 8 }}>{titulo}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ ...S.label, fontSize: 10 }}>Fecha</label>
          <input type="date"
            value={form.fecha}
            onChange={e => onChange(f => ({ ...f, fecha: e.target.value }))}
            style={{ ...S.input, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ ...S.label, fontSize: 10 }}>HH trabajadas</label>
          <input type="number" min="0" step="0.5"
            value={form.hhTrabajadas}
            onChange={e => onChange(f => ({ ...f, hhTrabajadas: e.target.value }))}
            style={{ ...S.input, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ ...S.label, fontSize: 10 }}>Detalle de trabajo</label>
          <input
            value={form.observaciones}
            onChange={e => onChange(f => ({ ...f, observaciones: e.target.value }))}
            placeholder="Resumen del trabajo hoy…"
            style={{ ...S.input, fontSize: 13 }} />
        </div>
      </div>
      {/* Tareas del día */}
      {form.tareas.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {form.tareas.map((t, ti) => (
            <div key={ti} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 12, background: "#e0eeff", borderRadius: 5, padding: "4px 8px", color: "#1e293b" }}>{t}</span>
              <button type="button" onClick={() => onChange(f => ({ ...f, tareas: f.tareas.filter((_, j) => j !== ti) }))}
                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input
          value={form.tareaInput}
          onChange={e => onChange(f => ({ ...f, tareaInput: e.target.value }))}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              const t = form.tareaInput.trim();
              if (t) onChange(f => ({ ...f, tareas: [...f.tareas, t], tareaInput: "" }));
            }
          }}
          placeholder="Tarea ejecutada hoy — Enter para agregar"
          style={{ ...S.input, fontSize: 12, flex: 1 }} />
        <button type="button"
          onClick={() => { const t = form.tareaInput.trim(); if (t) onChange(f => ({ ...f, tareas: [...f.tareas, t], tareaInput: "" })); }}
          style={{ ...S.btnOutline, padding: "7px 10px", fontSize: 12 }}>+ Agregar</button>
      </div>
      {/* Evidencias del avance */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ ...S.label, fontSize: 10, marginBottom: 6 }}>Evidencias (fotos / documentos)</label>
        {form.adjuntos.map((adj, i) => (
          <AdjuntoCard key={adj.id}
            adj={adj}
            onChange={updated => onChange(f => { const upd = [...f.adjuntos]; upd[i] = updated; return { ...f, adjuntos: upd }; })}
            onRemove={() => onChange(f => ({ ...f, adjuntos: f.adjuntos.filter((_, j) => j !== i) }))}
          />
        ))}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1.5px dashed #94a3b8", borderRadius: 8, cursor: cargandoAdj ? "not-allowed" : "pointer", background: "white", fontSize: 12, color: "#475569", fontWeight: 600 }}>
            <span style={{ fontSize: 16 }}>📷</span>
            {cargandoAdj ? "Procesando…" : "Tomar foto / imagen"}
            <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
              disabled={cargandoAdj}
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                onCargandoAdjChange(true);
                try {
                  const dataUrl = await comprimirImagen(file);
                  onChange(f => ({ ...f, adjuntos: [...f.adjuntos, { id: Math.random().toString(36).slice(2), tipo: "foto", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] }));
                } finally { onCargandoAdjChange(false); e.target.value = ""; }
              }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1.5px dashed #94a3b8", borderRadius: 8, cursor: cargandoAdj ? "not-allowed" : "pointer", background: "white", fontSize: 12, color: "#475569", fontWeight: 600 }}>
            <span style={{ fontSize: 16 }}>🖼️</span>
            Galería (JPG/PNG)
            <input type="file" accept="image/jpeg,image/png,image/heic,image/webp" style={{ display: "none" }}
              disabled={cargandoAdj}
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                onCargandoAdjChange(true);
                try {
                  const dataUrl = await comprimirImagen(file);
                  onChange(f => ({ ...f, adjuntos: [...f.adjuntos, { id: Math.random().toString(36).slice(2), tipo: "foto", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] }));
                } finally { onCargandoAdjChange(false); e.target.value = ""; }
              }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1.5px dashed #94a3b8", borderRadius: 8, cursor: cargandoAdj ? "not-allowed" : "pointer", background: "white", fontSize: 12, color: "#475569", fontWeight: 600 }}>
            <span style={{ fontSize: 16 }}>📄</span>
            Documento (PDF/Word)
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" style={{ display: "none" }}
              disabled={cargandoAdj}
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                onCargandoAdjChange(true);
                try {
                  const dataUrl = await leerDocumento(file);
                  onChange(f => ({ ...f, adjuntos: [...f.adjuntos, { id: Math.random().toString(36).slice(2), tipo: "documento", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] }));
                } finally { onCargandoAdjChange(false); e.target.value = ""; }
              }} />
          </label>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancelar}
          style={{ fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", color: "#64748b" }}>
          Cancelar
        </button>
        <button onClick={onGuardar} disabled={guardando || !form.hhTrabajadas}
          style={{ ...S.btnPrimary(!form.hhTrabajadas || guardando), fontSize: 12, padding: "5px 14px" }}>
          {guardando ? "Guardando…" : "Guardar avance"}
        </button>
      </div>
    </div>
  );
}

// ─── LineaEditor ─────────────────────────────────────────────────────────────

function LineaEditor({
  linea, area, isNew, soloCorrectivos, fecha, onFechaChange, onConfirm, onCancel,
}: {
  linea: LineaForm; area: string; isNew: boolean; soloCorrectivos?: boolean;
  fecha?: string; onFechaChange?: (fecha: string) => void;
  onConfirm: (l: LineaForm) => void;
  onCancel: () => void;
}) {
  const [L, setL] = useState(linea);
  const [tareaInput, setTareaInput] = useState("");
  const [showInsp, setShowInsp] = useState(!!linea.inspeccion);
  const [modosList, setModosList] = useState<ModoEntry[]>([]);
  const [causas, setCausas] = useState<FaultEntry[]>([]);
  const [checklists, setChecklists] = useState<ChecklistItem[]>([]);
  const [loadingCl, setLoadingCl] = useState(false);
  const [cargandoAdj, setCargandoAdj] = useState(false);

  function patch(p: Partial<LineaForm>) { setL(prev => ({ ...prev, ...p })); }

  // Auto-enriquecer equipo cuando viene del plan (tag presente pero sin categoriaISO/tipoEquipo)
  useEffect(() => {
    if (!L.tag || L.tipoEquipo) return; // ya tiene datos del equipo
    fetch(`/api/equipos?tag=${encodeURIComponent(L.tag)}`)
      .then(r => r.json())
      .then((data: EquipoResult[]) => {
        const eq = data[0];
        if (!eq) return;
        const catISO = derivarCategoriaISO(eq.categoriaISO, eq.tipoEquipo);
        patch({
          descripcionEquipo: eq.descripcion || L.descripcionEquipo,
          tipoEquipo: eq.tipoEquipo ?? "",
          categoriaISO: catISO,
          criticidad: eq.criticidad ?? "",
          nivel: eq.nivel ?? 0,
          disciplina: detectarDisciplina(eq.tag, catISO, eq.tipoEquipo, eq.descripcionTipo),
          areaProceso: detectarAreaProceso(eq.descripcionArea),
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.tag]);

  // Carga checklists cuando cambia TAG (disciplina/nivel/areaProceso)
  useEffect(() => {
    if (!L.disciplina || !aplicaChecklist(L.nivel, L.disciplina, L.tipoOT)) {
      setChecklists([]); return;
    }
    setLoadingCl(true);
    // Nivel 6 usa las mismas plantillas que nivel 5; nivel 7 solo para Instrumentación
    const nivelQuery = L.nivel === 6 ? 5 : L.nivel;
    const p = new URLSearchParams({ disciplina: L.disciplina, nivelTag: String(nivelQuery) });
    if (L.areaProceso) p.set("areaProceso", L.areaProceso);
    if (L.categoriaISO) p.set("categoriaISO", L.categoriaISO);
    fetch(`/api/checklist-mantto?${p}`)
      .then(r => r.json())
      .then((data: ChecklistItem[]) => {
        setChecklists(data);
        // Auto-seleccionar si hay exactamente uno y aún no hay inspección
        if (data.length === 1 && !L.inspeccion) {
          const cl = data[0];
          const items = cl.items.slice().sort((a, b) => a.orden - b.orden).map(it => ({ descripcion: it.descripcion, sentido: it.sentido, ok: false, obs: "" }));
          setL(prev => ({ ...prev, inspeccion: { checklistId: cl._id, checklistNombre: `${prev.tag} — Inspección`, items } }));
          setShowInsp(true);
        }
      })
      .catch(() => setChecklists([]))
      .finally(() => setLoadingCl(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.tag, L.disciplina, L.nivel, L.areaProceso, L.tipoOT]);

  useEffect(() => {
    if (!isCorrectivo(L.tipoOT)) { setModosList([]); return; }
    const url = L.categoriaISO
      ? `/api/arbol-fallas?tipoEquipo=${encodeURIComponent(L.categoriaISO)}`
      : "/api/arbol-fallas";
    fetch(url)
      .then(r => r.json())
      .then((data: ModoEntry[]) => {
        // Fallback: si no hay modos para esa categoría, mostrar todos
        if (data.length === 0 && L.categoriaISO) {
          return fetch("/api/arbol-fallas").then(r => r.json());
        }
        return data;
      })
      .then(setModosList)
      .catch(() => setModosList([]));
  }, [L.tipoOT, L.categoriaISO]);

  useEffect(() => {
    if (!L.sintoma || !isCorrectivo(L.tipoOT)) { setCausas([]); return; }
    const modo = modosList.find(m => m.sintoma === L.sintoma);
    const params = new URLSearchParams();
    if (modo?.codigoModo) params.set("codigoModo", modo.codigoModo);
    else params.set("sintoma", L.sintoma);
    if (L.categoriaISO) params.set("tipoEquipo", L.categoriaISO);
    fetch(`/api/arbol-fallas?${params.toString()}`)
      .then(r => r.json())
      .then((data: FaultEntry[]) => {
        // Si el filtro por categoría devuelve vacío, reintentar sin filtro
        if (data.length === 0 && L.categoriaISO) {
          params.delete("tipoEquipo");
          return fetch(`/api/arbol-fallas?${params.toString()}`).then(r => r.json());
        }
        return data;
      })
      .then(setCausas)
      .catch(() => setCausas([]));
  }, [L.sintoma, L.categoriaISO, L.tipoOT, modosList]);

  const adjSinComentario = L.adjuntos.some(a => !a.comentario.trim());
  const canConfirm = !!L.tag && !!L.tipoOT && !adjSinComentario && !!L.descripcionTrabajo.trim() && !!L.estadoFinal;

  const EstadoFinalSelector = (
    <div style={{ marginBottom: 13 }}>
      <label style={S.label}>Estado final del equipo *</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
        {ESTADO_FINAL_OPTIONS.map(o => {
          const active = L.estadoFinal === o.value;
          return (
            <button key={o.value} type="button" onClick={() => patch({ estadoFinal: o.value })}
              style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: active ? `2px solid ${o.color}` : "1px solid #e2e8f0", background: active ? o.color + "15" : "white", color: active ? o.color : "#64748b", fontWeight: active ? 800 : 400 }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const HHTrabajadasField = (
    <div style={{ marginBottom: 13 }}>
      <label style={S.label}>HH Trabajadas{isCorrectivo(L.tipoOT) ? " *" : ""}</label>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>(personas × horas)</div>
      <input type="number" min="0" step="0.5" value={L.tiempoRealHrs} onChange={e => patch({ tiempoRealHrs: e.target.value })} style={S.input} />
    </div>
  );

  const TareasEjecutadasField = (
    <div style={{ marginBottom: 13 }}>
      <label style={S.label}>Tareas ejecutadas</label>
      {L.tareasEjecutadas.map((t, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          <span style={{ flex: 1, fontSize: 13, color: "#1e293b", background: "#f1f5f9", borderRadius: 6, padding: "6px 10px" }}>{t}</span>
          <button type="button" onClick={() => patch({ tareasEjecutadas: L.tareasEjecutadas.filter((_, j) => j !== i) })}
            style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={tareaInput} onChange={e => setTareaInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (tareaInput.trim()) { patch({ tareasEjecutadas: [...L.tareasEjecutadas, tareaInput.trim()] }); setTareaInput(""); } } }}
          placeholder="Tarea ejecutada — Enter para agregar" style={{ ...S.input, flex: 1 }} />
        <button type="button" onClick={() => { if (tareaInput.trim()) { patch({ tareasEjecutadas: [...L.tareasEjecutadas, tareaInput.trim()] }); setTareaInput(""); } }}
          style={{ ...S.btnOutline, padding: "9px 13px", fontSize: 13 }}>+ Agregar</button>
      </div>
    </div>
  );

  return (
    <div style={{ ...S.card, border: "2px solid #2563eb", background: "#f8fbff", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847" }}>
          {isNew ? "Agregar equipo intervenido" : "Detalles del trabajo"}
        </div>
        {onFechaChange && (
          <div>
            <label style={{ ...S.label, marginBottom: 3, textAlign: "right" as const }}>Fecha de ejecución</label>
            <input type="date" value={fecha ?? ""} onChange={e => onFechaChange(e.target.value)}
              style={{ ...S.input, width: 150, padding: "6px 9px", fontSize: 13 }} />
          </div>
        )}
      </div>

      {/* TAG */}
      <div style={{ marginBottom: 13 }}>
        <label style={S.label}>TAG del equipo *</label>
        <TagSearch value={L.tag} area={area} onSelect={eq => {
          const catISO = derivarCategoriaISO(eq.categoriaISO, eq.tipoEquipo);
          patch({
            tag: eq.tag, descripcionEquipo: eq.descripcion, tipoEquipo: eq.tipoEquipo ?? "",
            categoriaISO: catISO, criticidad: eq.criticidad ?? "",
            nivel: eq.nivel ?? 0,
            disciplina: detectarDisciplina(eq.tag, catISO, eq.tipoEquipo, eq.descripcionTipo),
            areaProceso: detectarAreaProceso(eq.descripcionArea),
            inspeccion: null,
          });
        }} />
        {L.tag && <p style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
          {L.descripcionEquipo}
          {L.tipoEquipo && ` — ${L.tipoEquipo}`}
          {L.criticidad && ` — Crit. ${L.criticidad}`}
          {L.categoriaISO
            ? <span style={{ color: "#16a34a", fontWeight: 600 }}> · ISO: {L.categoriaISO}</span>
            : <span style={{ color: "#dc2626", fontWeight: 600 }}> · ISO: genérico</span>}
        </p>}
      </div>

      {/* Tipo OT */}
      <div style={{ marginBottom: 13 }}>
        <label style={S.label}>Tipo de OT *</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(soloCorrectivos ? TIPOS_OT.filter(t => t.value === "CMP" || t.value === "CMR") : TIPOS_OT).map(t => {
            const active = L.tipoOT === t.value;
            return (
              <button key={t.value} type="button" title={t.desc}
                onClick={() => patch({ tipoOT: t.value, sintoma: "", causaProbable: "", resolucionAplicada: "", estadoFinal: L.estadoFinal, tiempoEstimadoHrs: isCorrectivo(t.value) ? L.tiempoEstimadoHrs : "", descripcionTrabajo: L.descripcionTrabajo, tareasEjecutadas: [] })}
                style={{ padding: "7px 13px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: active ? `2px solid ${t.color}` : "1px solid #e2e8f0", background: active ? t.color + "15" : "white", color: active ? t.color : "#64748b", fontWeight: active ? 800 : 400 }}>
                {t.label}
              </button>
            );
          })}
        </div>
        {L.tipoOT && <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{TIPOS_OT.find(t => t.value === L.tipoOT)?.desc}</p>}
      </div>

      {/* CMP — Correctivo Mayor Programado (sin árbol de fallas) */}
      {L.tipoOT === "CMP" && (
        <>
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Detalle del trabajo realizado *</label>
            <textarea value={L.descripcionTrabajo} onChange={e => patch({ descripcionTrabajo: e.target.value })}
              placeholder="Describe el trabajo ejecutado (pre-cargado del plan)" style={S.textarea} />
          </div>
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Resolución / observación del resultado</label>
            <textarea value={L.resolucionAplicada} onChange={e => patch({ resolucionAplicada: e.target.value })}
              placeholder="¿Pendiente algún trabajo? Detalles adicionales del resultado" style={S.textarea} />
          </div>
          {TareasEjecutadasField}
          {EstadoFinalSelector}
          {HHTrabajadasField}
        </>
      )}

      {/* CMR — Correctivo Menor Rutinario (con árbol de fallas) */}
      {L.tipoOT === "CMR" && (
        <>
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Síntoma observado</label>
            <select value={L.sintoma} onChange={e => patch({ sintoma: e.target.value, causaProbable: "", resolucionAplicada: "" })} style={S.select}>
              <option value="">— Seleccionar modo de falla —</option>
              {modosList.map(m => (
                <option key={m.codigoModo || m.sintoma} value={m.sintoma}>
                  {m.codigoModo ? `[${m.codigoModo}] ` : ""}{m.sintoma}
                </option>
              ))}
            </select>
          </div>
          {L.sintoma && (
            <div style={{ marginBottom: 13 }}>
              <label style={S.label}>Causa probable</label>
              <select value={L.causaProbable}
                onChange={e => {
                  const entry = causas.find(c => c.causaProbable === e.target.value);
                  patch({ causaProbable: e.target.value, resolucionAplicada: entry?.resolucionSugerida ?? "", tiempoEstimadoHrs: entry?.tiempoEstimadoHrs ? String(entry.tiempoEstimadoHrs) : L.tiempoEstimadoHrs });
                }}
                style={S.select}>
                <option value="">— Seleccionar causa —</option>
                {causas.map(c => (
                  <option key={c.codigoCausa || c.causaProbable} value={c.causaProbable}>
                    {c.codigoCausa ? `[${c.codigoCausa}] ` : ""}{c.causaProbable}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Detalle del trabajo realizado *</label>
            <textarea value={L.descripcionTrabajo} onChange={e => patch({ descripcionTrabajo: e.target.value })}
              placeholder="Describe el trabajo ejecutado" style={S.textarea} />
          </div>
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Resolución / observación del resultado</label>
            <textarea value={L.resolucionAplicada} onChange={e => patch({ resolucionAplicada: e.target.value })} placeholder="Describe lo que se hizo para resolver la falla" style={S.textarea} />
          </div>
          {TareasEjecutadasField}
          {EstadoFinalSelector}
          {HHTrabajadasField}
        </>
      )}

      {/* Preventivo */}
      {isPreventivo(L.tipoOT) && (
        <>
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Detalle del trabajo realizado *</label>
            <textarea value={L.descripcionTrabajo} onChange={e => patch({ descripcionTrabajo: e.target.value })} placeholder="Detalle del trabajo preventivo ejecutado" style={S.textarea} />
          </div>
          {TareasEjecutadasField}
          <div style={{ marginBottom: 13 }}>
            <label style={S.label}>Resolución / observación del resultado</label>
            <textarea value={L.resolucionAplicada} onChange={e => patch({ resolucionAplicada: e.target.value })}
              placeholder="Observaciones adicionales sobre el resultado (opcional)" style={S.textarea} />
          </div>
          {EstadoFinalSelector}
          {HHTrabajadasField}
          <div style={{ marginBottom: 13 }}>
            {aplicaChecklist(L.nivel, L.disciplina, L.tipoOT) && (() => {
              const DISC_ICON: Record<string, { emoji: string; color: string; bg: string }> = {
                Mecanico:       { emoji: "⚙️",  color: "#0891b2", bg: "#ecfeff" },
                Electrico:      { emoji: "⚡",  color: "#d97706", bg: "#fffbeb" },
                Instrumentacion:{ emoji: "📡",  color: "#7c3aed", bg: "#f5f3ff" },
              };
              const disc = DISC_ICON[L.disciplina] ?? { emoji: "🔧", color: "#0891b2", bg: "#ecfeff" };
              const active = showInsp || !!L.inspeccion;
              return (
                <button type="button" onClick={() => setShowInsp(v => !v)}
                  style={{ padding: "8px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: active ? `2px solid ${disc.color}` : "1px solid #e2e8f0", background: active ? disc.bg : "white", color: active ? disc.color : "#64748b", fontWeight: 600, whiteSpace: "nowrap" as const, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{disc.emoji}</span>
                  <span>{loadingCl ? "…" : L.inspeccion ? "✓ Inspección" : "Inspección"}</span>
                  {L.disciplina && <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 500 }}>{L.disciplina.slice(0, 4).toUpperCase()}</span>}
                </button>
              );
            })()}
          </div>
          {showInsp && (
            <div style={{ border: "1.5px solid #0891b2", borderRadius: 10, padding: "13px 14px", marginBottom: 13, background: "#f0fdff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>Inspección / Checklist</span>
                <button type="button" onClick={() => { setShowInsp(false); patch({ inspeccion: null }); }} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
              {checklists.length === 0 ? (
                <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
                  {loadingCl ? "Cargando checklist…" : "Sin plantilla de inspección para este equipo. Ejecuta el seed de checklists en Configuración."}
                </p>
              ) : !L.inspeccion ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {checklists.map(cl => (
                    <button key={cl._id} type="button"
                      onClick={() => {
                        const items = cl.items.slice().sort((a, b) => a.orden - b.orden).map(it => ({ descripcion: it.descripcion, sentido: it.sentido, ok: false, obs: "" }));
                        patch({ inspeccion: { checklistId: cl._id, checklistNombre: `${L.tag} — Inspección`, items } });
                      }}
                      style={{ textAlign: "left" as const, padding: "9px 12px", borderRadius: 8, cursor: "pointer", border: "1px solid #a5f3fc", background: "white", fontSize: 13, color: "#0f172a" }}>
                      {cl.nombre} <span style={{ fontSize: 11, color: "#64748b" }}>({cl.items.length} ítems)</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0891b2" }}>{L.inspeccion.checklistNombre}</span>
                    <button type="button" onClick={() => patch({ inspeccion: null })} style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>cambiar</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {L.inspeccion.items.map((it, idx) => {
                      const meta = SENTIDO_META[it.sentido ?? "Visual"];
                      return (
                        <div key={idx} style={{ background: "white", borderRadius: 8, border: `1px solid ${it.ok ? "#a7f3d0" : "#e0f7fa"}`, overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px" }}>
                            {/* Ícono sentido */}
                            <span title={meta.label} style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>{meta.emoji}</span>
                            {/* Checkbox */}
                            <input type="checkbox" checked={it.ok}
                              onChange={e => { const upd = [...L.inspeccion!.items]; upd[idx] = { ...upd[idx], ok: e.target.checked }; patch({ inspeccion: { ...L.inspeccion!, items: upd } }); }}
                              style={{ width: 16, height: 16, accentColor: "#0891b2", cursor: "pointer", flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: 13, color: it.ok ? "#64748b" : "#1e293b", textDecoration: it.ok ? "line-through" : "none" }}>
                              {it.descripcion}
                            </span>
                            {it.ok && <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, flexShrink: 0 }}>OK</span>}
                          </div>
                          {/* Campo anomalía — solo visible si no está OK, o si tiene texto */}
                          {(!it.ok || it.obs) && (
                            <div style={{ borderTop: "1px solid #f1f5f9", padding: "5px 11px 7px" }}>
                              <input type="text" value={it.obs}
                                onChange={e => { const upd = [...L.inspeccion!.items]; upd[idx] = { ...upd[idx], obs: e.target.value }; patch({ inspeccion: { ...L.inspeccion!, items: upd } }); }}
                                placeholder="Anomalía / observación"
                                style={{ ...S.input, fontSize: 12, padding: "4px 8px", background: it.obs ? "#fef3c7" : "#f8fafc", borderColor: it.obs ? "#fcd34d" : "#e2e8f0" }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Evidencias: Fotos y Documentos ── */}
      {L.tipoOT && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 10 }}>
            Evidencias (fotos / documentos)
          </div>

          {/* Lista de adjuntos ya agregados */}
          {L.adjuntos.map((adj, i) => (
            <AdjuntoCard key={adj.id}
              adj={adj}
              onChange={updated => {
                const upd = [...L.adjuntos];
                upd[i] = updated;
                patch({ adjuntos: upd });
              }}
              onRemove={() => patch({ adjuntos: L.adjuntos.filter((_, j) => j !== i) })}
            />
          ))}

          {/* Botones para agregar */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
            {/* Foto */}
            <label style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", border: "1.5px dashed #94a3b8", borderRadius: 8, cursor: cargandoAdj ? "not-allowed" : "pointer", background: "white", fontSize: 13, color: "#475569", fontWeight: 600 }}>
              <span style={{ fontSize: 18 }}>📷</span>
              {cargandoAdj ? "Procesando…" : "Tomar foto / imagen"}
              <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                disabled={cargandoAdj}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setCargandoAdj(true);
                  try {
                    const dataUrl = await comprimirImagen(file);
                    patch({ adjuntos: [...L.adjuntos, { id: Math.random().toString(36).slice(2), tipo: "foto", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] });
                  } finally { setCargandoAdj(false); e.target.value = ""; }
                }} />
            </label>

            {/* Seleccionar imagen de galería */}
            <label style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", border: "1.5px dashed #94a3b8", borderRadius: 8, cursor: cargandoAdj ? "not-allowed" : "pointer", background: "white", fontSize: 13, color: "#475569", fontWeight: 600 }}>
              <span style={{ fontSize: 18 }}>🖼️</span>
              Galería (JPG/PNG)
              <input type="file" accept="image/jpeg,image/png,image/heic,image/webp" style={{ display: "none" }}
                disabled={cargandoAdj}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setCargandoAdj(true);
                  try {
                    const dataUrl = await comprimirImagen(file);
                    patch({ adjuntos: [...L.adjuntos, { id: Math.random().toString(36).slice(2), tipo: "foto", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] });
                  } finally { setCargandoAdj(false); e.target.value = ""; }
                }} />
            </label>

            {/* Documento */}
            <label style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", border: "1.5px dashed #94a3b8", borderRadius: 8, cursor: cargandoAdj ? "not-allowed" : "pointer", background: "white", fontSize: 13, color: "#475569", fontWeight: 600 }}>
              <span style={{ fontSize: 18 }}>📄</span>
              Documento (PDF/Word)
              <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" style={{ display: "none" }}
                disabled={cargandoAdj}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setCargandoAdj(true);
                  try {
                    const dataUrl = await leerDocumento(file);
                    patch({ adjuntos: [...L.adjuntos, { id: Math.random().toString(36).slice(2), tipo: "documento", nombre: file.name, dataUrl, comentario: "", comentariosExtra: [] }] });
                  } finally { setCargandoAdj(false); e.target.value = ""; }
                }} />
            </label>
          </div>

          {adjSinComentario && (
            <p style={{ fontSize: 12, color: "#dc2626", marginTop: 8, fontWeight: 600 }}>
              ⚠ Todos los adjuntos deben tener un comentario antes de confirmar el equipo.
            </p>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={S.btnGhost}>Cancelar</button>
        <button type="button" onClick={() => onConfirm(L)} disabled={!canConfirm} style={S.btnPrimary(!canConfirm)}>Confirmar equipo</button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RegistroOTPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();

  const now = new Date();
  const { fecha: shiftFecha, turno: shiftTurno } = getFechaTurno();
  // today = fecha calendario real (para semana/día display)
  // shiftFecha = fecha del turno activo (puede ser ayer si son las 00:00-06:29)
  const today = localDateStr(now);
  const todayDia = DIA_MAP[now.getDay()];
  const currentSemana = getWeekNumber(now);
  const currentAnio = now.getFullYear();

  // ── Vista: "inicio" (listado plan) | "registro" (formulario) ──
  const [view, setView] = useState<"inicio" | "registro">("inicio");
  const [step, setStep] = useState(1);

  // ── Plan del Día ──
  const [planRefs, setPlanRefs] = useState<PlanRef[]>([]);
  const [diaSeleccionado, setDiaSeleccionado] = useState<DiaSem>(todayDia);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [filtroOT, setFiltroOT] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  // Solo se permite retroceder 1 semana, para que los técnicos puedan cerrar
  // OTs que quedaron pendientes al cambiar de semana.
  const [semanaOffset, setSemanaOffset] = useState(0);
  const { semana: semanaMostrada, anio: anioMostrado } = React.useMemo(
    () => getSemanaAnioOffset(currentSemana, currentAnio, semanaOffset),
    [currentSemana, currentAnio, semanaOffset]
  );
  // Cierre OPEPLANT habilitado solo para la semana que se está mostrando: si ya
  // terminó (semana anterior) siempre; si es la semana en curso, solo su domingo.
  const cierreSemanaHabilitado = estaEnVentanaCierreSemanal({
    semanaOT: semanaMostrada, anioOT: anioMostrado,
    semanaActual: currentSemana, anioActual: currentAnio,
  });

  // ── Formulario ──
  const emptyForm = useCallback((): FormData => ({
    fecha: shiftFecha, turno: shiftTurno, areaCodigo: "", tecnicos: [],
    lineas: [], programacionSemanalId: "", otJdeNumero: "", otJdeDia: "", origenPlan: false, esRecurrente: false,
  }), [shiftFecha, shiftTurno]);

  const [form, setForm] = useState<FormData>(emptyForm);
  const [areas, setAreas] = useState<AreaOption[]>([]);

  // Inline linea editor
  const [editLinea, setEditLinea] = useState<LineaForm | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [isNewLinea, setIsNewLinea] = useState(false);

  const [errs, setErrs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [done, setDone] = useState(false);
  const [doneOT, setDoneOT] = useState<{ numeroOT: string; estado: string; consolidado?: boolean; parentOtNum?: string | null } | null>(null);

  // Detección de OT madre OPEPLANT al escribir N° OT
  const [otMadreInfo, setOtMadreInfo] = useState<{ id: string; numeroOT: string } | null>(null);
  const otMadreTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function detectarOtMadre(valor: string) {
    if (otMadreTimer.current) clearTimeout(otMadreTimer.current);
    if (!valor || valor.length < 4) { setOtMadreInfo(null); return; }
    otMadreTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ordenes?otJdeNumero=${encodeURIComponent(valor)}&origenPlan=true&limit=1`);
        const data = await res.json();
        const madre = Array.isArray(data) && data.length > 0 ? data[0] : null;
        setOtMadreInfo(madre ? { id: madre._id, numeroOT: madre.numeroOT } : null);
      } catch { setOtMadreInfo(null); }
    }, 400);
  }

  // ── OTs recurrentes: misma numeroOT en 2+ días del plan ──
  const recurrentesNums = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of planRefs) counts[r.ot.numeroOT] = (counts[r.ot.numeroOT] || 0) + 1;
    return new Set(Object.entries(counts).filter(([, c]) => c >= 2).map(([n]) => n));
  }, [planRefs]);

  // ── Para recurrentes: mapa numeroOT → ref del día que YA tiene ordenTrabajoId ──
  // Permite que días sin vínculo directo usen el mismo OrdenTrabajo del hermano registrado.
  const refRegistradaMap = React.useMemo(() => {
    const map: Record<string, PlanRef> = {};
    for (const r of planRefs) {
      if (r.ot.ordenTrabajoId && recurrentesNums.has(r.ot.numeroOT)) {
        // Preferir el que está en_proceso sobre cualquier otro
        if (!map[r.ot.numeroOT] || r.ot.estado === "en_proceso") {
          map[r.ot.numeroOT] = r;
        }
      }
    }
    return map;
  }, [planRefs, recurrentesNums]);

  // ── OPEPLANT/guardia: estado real de la OT madre por otJdeNumero, para saber si ya
  // fue enviada a revisión/cerrada y no seguir ofreciendo "Cerrar OT de semana" ──
  const [guardiaEstadoMap, setGuardiaEstadoMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const nums = Array.from(new Set(
      planRefs
        .filter(r => r.ot.esGuardia || r.ot.tag?.includes("OPEPLANT"))
        .map(r => r.ot.numeroOT)
    ));
    let cancelado = false;
    (async () => {
      const entradas = await Promise.all(nums.map(async (num) => {
        try {
          const data = await fetch(`/api/ordenes?otJdeNumero=${encodeURIComponent(num)}&origenPlan=true&limit=1`).then(r => r.json());
          const madre = Array.isArray(data) && data.length > 0 ? data[0] : null;
          return [num, madre?.estado as string | undefined] as const;
        } catch { return [num, undefined] as const; }
      }));
      if (!cancelado) setGuardiaEstadoMap(Object.fromEntries(entradas.filter((e): e is [string, string] => !!e[1])));
    })();
    return () => { cancelado = true; };
  }, [planRefs]);

  // ── Avance diario para OTs recurrentes ya iniciadas ──
  const [avanceRef, setAvanceRef] = useState<PlanRef | null>(null);
  const [avanceForm, setAvanceForm] = useState<AvanceDiarioForm>({ fecha: shiftFecha, hhTrabajadas: "", tareas: [], tareaInput: "", observaciones: "", adjuntos: [] });
  const [savingAvance, setSavingAvance] = useState(false);
  const [savingRevision, setSavingRevision] = useState(false);
  const [cargandoAdjAvance, setCargandoAdjAvance] = useState(false);

  async function confirmarAvanceDiario() {
    if (!avanceRef?.ot.ordenTrabajoId) return;
    setSavingAvance(true);
    try {
      const res = await fetch(`/api/ordenes/${avanceRef.ot.ordenTrabajoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registroDiario: {
            fecha: avanceForm.fecha,
            tecnico: user?.nombre ?? "Técnico",
            usuarioId: user?.id,
            hhTrabajadas: parseFloat(avanceForm.hhTrabajadas) || 0,
            tareasEjecutadas: avanceForm.tareas,
            observaciones: avanceForm.observaciones || null,
            adjuntos: avanceForm.adjuntos.map(a => ({ tipo: a.tipo, nombre: a.nombre, dataUrl: a.dataUrl, comentario: a.comentario, comentariosExtra: a.comentariosExtra })),
          },
          cambio: `Avance del día ${avanceRef.ot.dia} registrado`,
          usuarioId: user?.id,
          nombreUsuario: user?.nombre,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Error al guardar avance");
      }
      setAvanceRef(null);
      setAvanceForm({ fecha: shiftFecha, hhTrabajadas: "", tareas: [], tareaInput: "", observaciones: "", adjuntos: [] });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al guardar avance");
    } finally {
      setSavingAvance(false);
    }
  }

  async function enviarRevisionRecurrente(ref: PlanRef) {
    if (!ref.ot.ordenTrabajoId) return;
    setSavingRevision(true);
    try {
      const res = await fetch(`/api/ordenes/${ref.ot.ordenTrabajoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "pendiente_revision",
          cambio: "OT recurrente enviada a revisión — ciclo semanal completo",
          usuarioId: user?.id,
          nombreUsuario: user?.nombre,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Error al enviar a revisión");
      }
      // Persistir el nuevo estado en TODOS los días del plan que comparten este numeroOT
      // (una OT recurrente ocupa una fila por día): si no, al recargar el plan (cambiar de
      // semana, volver a entrar) el botón "Enviar a revisión" reaparece habilitado.
      await fetch(`/api/programacion-semanal/${ref.planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroOT: ref.ot.numeroOT, todosLosDias: true, estado: "en_revision" }),
      });
      // Actualizar estado local en todas las filas de esta OT (no solo la que tiene ordenTrabajoId)
      setPlanRefs(prev => prev.map(r =>
        r.planId === ref.planId && r.ot.numeroOT === ref.ot.numeroOT
          ? { ...r, ot: { ...r.ot, estado: "en_revision" } as OTPlan }
          : r
      ));
    } finally {
      setSavingRevision(false);
    }
  }

  // ── OTs reactivas (CMR/CMP) abiertas: continuar en vez de duplicar ──
  // A diferencia de las OTs del plan, las reactivas no tienen PlanRef —
  // se detectan y se registran directamente por su ordenTrabajoId.
  const ESTADOS_OT_CERRADA = ["pendiente_revision", "revisado", "concluido"];

  const [otReactivaAbierta, setOtReactivaAbierta] = useState<{ id: string; numeroOT: string; otJdeNumero: string; estado: string; fecha: string; tecnicos: { nombreCompleto: string }[] } | null>(null);
  const otReactivaTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function detectarOtReactivaAbierta(valor: string) {
    if (otReactivaTimer.current) clearTimeout(otReactivaTimer.current);
    if (!valor || valor.length < 4) { setOtReactivaAbierta(null); return; }
    otReactivaTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ordenes?otJdeNumero=${encodeURIComponent(valor)}&origenPlan=false&limit=5`);
        const data = await res.json();
        const abierta = Array.isArray(data)
          ? data.find((o: { estado: string }) => !ESTADOS_OT_CERRADA.includes(o.estado))
          : null;
        setOtReactivaAbierta(abierta
          ? { id: abierta._id, numeroOT: abierta.numeroOT, otJdeNumero: abierta.otJdeNumero, estado: abierta.estado, fecha: abierta.fecha, tecnicos: abierta.tecnicos ?? [] }
          : null);
      } catch { setOtReactivaAbierta(null); }
    }, 400);
  }

  const [avanceReactivaRef, setAvanceReactivaRef] = useState<{ id: string; numeroOT: string } | null>(null);
  const [avanceReactivaForm, setAvanceReactivaForm] = useState<AvanceDiarioForm>({ fecha: shiftFecha, hhTrabajadas: "", tareas: [], tareaInput: "", observaciones: "", adjuntos: [] });
  const [savingAvanceReactiva, setSavingAvanceReactiva] = useState(false);
  const [cargandoAdjAvanceReactiva, setCargandoAdjAvanceReactiva] = useState(false);
  const [enviandoRevisionReactiva, setEnviandoRevisionReactiva] = useState(false);

  async function confirmarAvanceReactiva() {
    if (!avanceReactivaRef) return;
    setSavingAvanceReactiva(true);
    try {
      const res = await fetch(`/api/ordenes/${avanceReactivaRef.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registroDiario: {
            fecha: avanceReactivaForm.fecha,
            tecnico: user?.nombre ?? "Técnico",
            usuarioId: user?.id,
            hhTrabajadas: parseFloat(avanceReactivaForm.hhTrabajadas) || 0,
            tareasEjecutadas: avanceReactivaForm.tareas,
            observaciones: avanceReactivaForm.observaciones || null,
            adjuntos: avanceReactivaForm.adjuntos.map(a => ({ tipo: a.tipo, nombre: a.nombre, dataUrl: a.dataUrl, comentario: a.comentario, comentariosExtra: a.comentariosExtra })),
          },
          cambio: `Avance del día registrado sobre OT reactiva ${avanceReactivaRef.numeroOT}`,
          usuarioId: user?.id,
          nombreUsuario: user?.nombre,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Error al guardar avance");
      }
      setAvanceReactivaRef(null);
      setOtReactivaAbierta(null);
      patchForm({ otJdeNumero: "" });
      setView("inicio");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al guardar avance");
    } finally {
      setSavingAvanceReactiva(false);
    }
  }

  async function enviarRevisionReactiva(ot: { id: string; numeroOT: string }) {
    setEnviandoRevisionReactiva(true);
    try {
      const res = await fetch(`/api/ordenes/${ot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "pendiente_revision",
          cambio: "OT reactiva enviada a revisión — trabajo concluido",
          usuarioId: user?.id,
          nombreUsuario: user?.nombre,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Error al enviar a revisión");
      }
      setAvanceReactivaRef(null);
      setOtReactivaAbierta(null);
      patchForm({ otJdeNumero: "" });
      setView("inicio");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error al enviar a revisión");
    } finally {
      setEnviandoRevisionReactiva(false);
    }
  }

  // ── Detalle OTs ya registradas ──
  const [otDetalles, setOtDetalles] = useState<Record<string, OTDetalle | null>>({});

  async function cargarOtDetalle(ordenTrabajoId: string) {
    if (ordenTrabajoId in otDetalles) return;
    setOtDetalles(prev => ({ ...prev, [ordenTrabajoId]: null }));
    try {
      const res = await fetch(`/api/ordenes/${ordenTrabajoId}`);
      if (res.ok) {
        const data = await res.json();
        setOtDetalles(prev => ({ ...prev, [ordenTrabajoId]: { _id: data._id, numeroOT: data.numeroOT, estado: data.estado, turno: data.turno, tecnicos: data.tecnicos ?? [], lineas: data.lineas ?? [] } }));
      }
    } catch { /* ignore */ }
  }


  // ── Pasar a Noche ──
  const [pasarNocheRef, setPasarNocheRef] = useState<PlanRef | null>(null);
  const [pasarNocheMotivo, setPasarNocheMotivo] = useState("Sin tiempo en el turno");
  const [pasarNocheNota, setPasarNocheNota] = useState("");
  const [savingNoche, setSavingNoche] = useState(false);

  async function confirmarPasarNoche() {
    if (!pasarNocheRef) return;
    setSavingNoche(true);
    try {
      await fetch(`/api/programacion-semanal/${pasarNocheRef.planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numeroOT: pasarNocheRef.ot.numeroOT,
          dia: pasarNocheRef.ot.dia,
          pasarNoche: true,
          pasarNocheMotivo,
          pasarNocheNota,
          pasarNochePor: user?.nombre ?? "Supervisor",
        }),
      });
      // Actualizar el plan local sin recargar
      setPlanRefs(prev => prev.map(r =>
        r.planId === pasarNocheRef.planId && r.ot.numeroOT === pasarNocheRef.ot.numeroOT
          ? { ...r, ot: { ...r.ot, pasarNoche: true } as OTPlan }
          : r
      ));
      setPasarNocheRef(null);
      setPasarNocheNota("");
    } finally {
      setSavingNoche(false);
    }
  }

  function patchForm(patch: Partial<FormData>) { setForm(f => ({ ...f, ...patch })); }

  // ── Load areas ──
  useEffect(() => {
    fetch("/api/areas").then(r => r.json()).then(setAreas).catch(() => {});
  }, []);

  // ── Load plan del día ──
  const recargarPlan = React.useCallback(() => {
    if (!user) return;
    setLoadingPlan(true);
    const p = new URLSearchParams({ semana: String(semanaMostrada), anio: String(anioMostrado), limit: "50" });
    fetch(`/api/programacion-semanal?${p}`)
      .then(r => r.json())
      .then((planes: PlanDoc[]) => {
        const refs: PlanRef[] = [];
        for (const plan of planes) {
          // Cargar TODAS las OTs de la semana (todos los días)
          for (const ot of plan.otsProgramadas) {
            if (user.rol === 4 || user.rol === 6) {
              // Match por identidad (usuarioId) — exacto, independiente del texto del nombre.
              const matchPorId = (ot.personalAsignadoIds ?? []).includes(user.id);
              // Fallback por nombre para OTs aún sin IDs (planes viejos / no re-editados).
              const matchPorNombre = (ot.personalAsignado ?? []).some(p => nombreCoincide(p, user.nombre));
              // Fallback de área para rol=6: si el plan es de su área y personalAsignado
              // no tiene nombres reales (solo "Contratista" genérico del Excel), mostrar igual.
              const paNames = (ot.personalAsignado ?? []).map(n => n.trim().toLowerCase());
              const soloGenerico = paNames.length === 0 || paNames.every(n => n === "contratista" || n === "");
              const matchPorArea = user.rol === 6
                && soloGenerico
                && (user.areas ?? []).includes(plan.areaCodigo ?? "");
              if (!matchPorId && !matchPorNombre && !matchPorArea) continue;
            } else if (user.rol >= 3 && user.areas?.length > 0 && plan.areaCodigo) {
              if (!user.areas.includes(plan.areaCodigo)) continue;
            }
            refs.push({ planId: String(plan._id), areaCodigo: plan.areaCodigo ?? "", ot });
          }
        }
        setPlanRefs(refs);
      })
      .catch(() => {})
      .finally(() => setLoadingPlan(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, semanaMostrada, anioMostrado]);

  useEffect(() => {
    if (authLoading || !user) return;
    recargarPlan();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, semanaMostrada, anioMostrado]);

  // Áreas presentes en el plan cargado (ya viene pre-filtrado por las áreas del
  // usuario en recargarPlan) — sirve para armar el selector "Área: X" de arriba.
  const areasEnPlan = React.useMemo(() => {
    const codigos = Array.from(new Set(planRefs.map(r => r.areaCodigo).filter(Boolean)));
    return codigos
      .map(codigo => ({ codigo, nombre: areas.find(a => a.codigo === codigo)?.nombre ?? codigo }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [planRefs, areas]);

  // Si el área elegida deja de estar disponible (cambio de semana, etc.), resetear a "Todas"
  useEffect(() => {
    if (filtroArea && !areasEnPlan.some(a => a.codigo === filtroArea)) setFiltroArea("");
  }, [areasEnPlan, filtroArea]);

  // ─── Seleccionar OT del plan → abrir registro ──────────────────────────────

  function abrirRegistroPlan(ref: PlanRef, esRecurrente = false) {
    const linea = lineaFromPlan(ref.ot);
    // Pre-cargar personal asignado en el plan
    const tecnicos: FormData["tecnicos"] = ref.ot.personalAsignado.map(nombre => ({
      usuarioId: "",
      nombreCompleto: nombre,
    }));
    // Agregar usuario logueado si es técnico y no está ya en la lista.
    // Usamos nombreCoincide para manejar diferencias de orden (ej: "Sabino Taquichiri" vs "Taquichiri Mamani Sabino")
    if (user && user.rol === 4) {
      const yaEsta = tecnicos.some(t => nombreCoincide(t.nombreCompleto, user.nombre) || nombreCoincide(user.nombre, t.nombreCompleto));
      if (yaEsta) {
        // Reemplazar la entrada del plan con el nombre oficial del sistema + usuarioId
        const idx = tecnicos.findIndex(t => nombreCoincide(t.nombreCompleto, user.nombre) || nombreCoincide(user.nombre, t.nombreCompleto));
        if (idx >= 0) tecnicos[idx] = { usuarioId: user.id, nombreCompleto: user.nombre };
      } else {
        tecnicos.push({ usuarioId: user.id, nombreCompleto: user.nombre });
      }
    }
    setForm({
      fecha: shiftFecha,
      turno: shiftTurno,
      areaCodigo: ref.areaCodigo,
      tecnicos,
      lineas: [linea],
      programacionSemanalId: ref.planId,
      otJdeNumero: ref.ot.numeroOT,
      // Para recurrentes no filtramos por día (el backend vinculará todos los días)
      otJdeDia: esRecurrente ? "" : ref.ot.dia,
      origenPlan: true,
      esRecurrente,
    });
    // Abrir el editor de la linea pre-cargada
    setEditLinea({ ...linea });
    setEditIdx(0);
    setIsNewLinea(false);
    setStep(ref.areaCodigo ? 2 : 1);
    setView("registro");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function abrirRegistroReactivo() {
    setForm(emptyForm());
    setEditLinea(null);
    setStep(1);
    setView("registro");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function volverAlInicio() {
    setView("inicio");
    setEditLinea(null);
    setErrs({});
    setSubmitErr("");
  }

  // ─── Linea handlers ────────────────────────────────────────────────────────

  function confirmLinea(l: LineaForm) {
    if (isNewLinea) {
      patchForm({ lineas: [...form.lineas, l] });
    } else if (editIdx !== null) {
      const next = [...form.lineas];
      next[editIdx] = l;
      patchForm({ lineas: next });
    }
    setEditLinea(null);
    setEditIdx(null);
    setIsNewLinea(false);
  }

  function cancelLinea() {
    setEditLinea(null);
    setEditIdx(null);
    setIsNewLinea(false);
  }

  function openEdit(idx: number) {
    setEditLinea({ ...form.lineas[idx] });
    setEditIdx(idx);
    setIsNewLinea(false);
  }

  function removeLinea(idx: number) {
    patchForm({ lineas: form.lineas.filter((_, i) => i !== idx) });
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!form.fecha) e.fecha = "Seleccione la fecha";
    if (!form.turno) e.turno = "Seleccione el turno";
    if (!form.areaCodigo) e.areaCodigo = "Seleccione el área";
    if (form.tecnicos.length === 0) e.tecnicos = "Seleccione al menos un técnico";
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e: Record<string, string> = {};
    if (form.lineas.length === 0) e.lineas = "Agregue al menos un equipo intervenido";
    if (editLinea) e.edit = "Confirme o cancele el equipo en edición";
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function submit(estado: "borrador" | "pendiente_revision" | "en_proceso") {
    setSubmitting(true); setSubmitErr("");
    try {
      // OTs recurrentes siempre se crean en en_proceso (acumulan avances durante la semana)
      const estadoFinal = form.esRecurrente ? "en_proceso" : estado;
      const payload = {
        fecha: form.fecha, turno: form.turno, areaCodigo: form.areaCodigo,
        tecnicos: form.tecnicos, estado: estadoFinal,
        origenPlan: form.origenPlan,
        ...(form.origenPlan ? {
          programacionSemanalId: form.programacionSemanalId,
          otJdeNumero: form.otJdeNumero,
          otJdeDia: form.esRecurrente ? null : form.otJdeDia,
          esRecurrente: form.esRecurrente,
        } : { ...(form.otJdeNumero ? { otJdeNumero: form.otJdeNumero } : {}) }),
        lineas: form.lineas.map(l => ({
          tag: l.tag, descripcionEquipo: l.descripcionEquipo, tipoOT: l.tipoOT,
          adjuntos: l.adjuntos.map(a => ({ tipo: a.tipo, nombre: a.nombre, dataUrl: a.dataUrl, comentario: a.comentario, comentariosExtra: a.comentariosExtra })),
          descripcionTrabajo: l.descripcionTrabajo || undefined,
          resolucionAplicada: l.resolucionAplicada || undefined,
          estadoFinal: l.estadoFinal || undefined,
          ...(isCorrectivo(l.tipoOT) ? {
            sintoma: l.sintoma || undefined, causaProbable: l.causaProbable || undefined,
            tiempoEstimadoHrs: l.tiempoEstimadoHrs ? Number(l.tiempoEstimadoHrs) : undefined,
            tiempoRealHrs: l.tiempoRealHrs ? Number(l.tiempoRealHrs) : undefined,
          } : {
            tareasEjecutadas: l.tareasEjecutadas.length > 0 ? l.tareasEjecutadas : undefined,
            tiempoRealHrs: l.tiempoRealHrs ? Number(l.tiempoRealHrs) : undefined,
          }),
          observaciones: l.observaciones || undefined,
        })),
      };
      const res = await fetch("/api/ordenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar");
      setDone(true);
      setDoneOT({ numeroOT: data.ot.numeroOT, estado: data.ot.estado, consolidado: data.consolidado ?? false, parentOtNum: data.ot.parentOtNum ?? null });
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Success ───────────────────────────────────────────────────────────────

  if (done && doneOT) {
    return (
      <div style={S.page}>
        <AppHeader backHref="/ordenes" />
        <div style={{ ...S.wrap, maxWidth: 460, textAlign: "center", paddingTop: 64 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>{doneOT.estado === "pendiente_revision" ? "📋" : doneOT.estado === "en_proceso" ? "🔓" : "💾"}</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1e293b", marginBottom: 6 }}>OT Registrada</h2>
          {form.otJdeNumero ? (
            <>
              <div style={{ fontSize: 30, fontWeight: 800, color: "#2563eb", letterSpacing: "0.04em", marginBottom: 4 }}>OT {form.otJdeNumero}</div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>Ref. interna #{doneOT.numeroOT}</div>
            </>
          ) : (
            <div style={{ fontSize: 30, fontWeight: 800, color: "#2563eb", letterSpacing: "0.04em", marginBottom: 10 }}>#{doneOT.numeroOT}</div>
          )}
          {doneOT.parentOtNum && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#92400e" }}>
              🔄 Vinculada a bitácora OPEPLANT <strong>{form.otJdeNumero}</strong> — se verá agrupada en el Turnero
            </div>
          )}
          <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
            {doneOT.consolidado
              ? "Avance diario registrado en OT existente. La OT acumula todos los días de la semana."
              : doneOT.parentOtNum
                ? "OT registrada y vinculada a la OPEPLANT de la semana. No aparece suelta en el panel del supervisor."
                : doneOT.estado === "pendiente_revision" ? "OT enviada al supervisor para revisión."
                : doneOT.estado === "en_proceso" ? "OT guardada y abierta — busca el mismo N° OT otro día para agregar avances sin duplicarla."
                : "OT guardada como borrador."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => { setDone(false); setDoneOT(null); setView("inicio"); recargarPlan(); }} style={S.btnPrimary()}>Volver al plan</button>
            <button onClick={() => router.push("/ordenes/reporte")} style={S.btnGhost}>Ver tablero</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <AppHeader backHref="/ordenes" />
      <div style={S.wrap}>

        <div>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0f2847", marginBottom: 2 }}>Registro de OT</h1>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, whiteSpace: "nowrap" }}>Semana {currentSemana} · {today} ({todayDia})</p>
            {view === "inicio" && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {areasEnPlan.length > 1 && (
                  <select
                    value={filtroArea}
                    onChange={e => setFiltroArea(e.target.value)}
                    style={{ ...S.select, width: "auto", maxWidth: 110, padding: "5px 6px", fontSize: 11, borderColor: filtroArea ? "#2563eb" : "#cbd5e1", fontWeight: filtroArea ? 700 : 400 }}
                  >
                    <option value="">Todas las áreas</option>
                    {areasEnPlan.map(a => (
                      <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>
                    ))}
                  </select>
                )}
                <div style={{ position: "relative", width: 108 }}>
                  <input
                    value={filtroOT}
                    onChange={e => setFiltroOT(e.target.value)}
                    placeholder="Buscar OT…"
                    style={{ ...S.input, padding: "5px 24px 5px 8px", fontSize: 11, borderColor: "#2563eb" }}
                  />
                  {filtroOT && (
                    <button
                      onClick={() => setFiltroOT("")}
                      style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 13, lineHeight: 1 }}
                      aria-label="Limpiar filtro"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ════════════════ VISTA INICIO ════════════════════════════════════ */}
        {view === "inicio" && (
          <>
            {/* Plan Semanal — navegación por días */}
            <div style={{ ...S.card, border: "1px solid #bfdbfe", background: "#f8fbff", padding: 0, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#1d4ed8" }}>
                    Plan de la Semana {semanaMostrada}{semanaOffset !== 0 ? " (anterior)" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {user?.rol === 4 ? "Tus OTs programadas" : "OTs programadas de tu área"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {loadingPlan && <span style={{ fontSize: 12, color: "#94a3b8" }}>Cargando…</span>}
                  {semanaOffset === 0 ? (
                    <button
                      onClick={() => { setSemanaOffset(-1); setDiaSeleccionado("Do"); }}
                      style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", background: "white", border: "1px solid #bfdbfe", borderRadius: 7, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" as const }}
                    >
                      ‹ Semana anterior
                    </button>
                  ) : (
                    <button
                      onClick={() => { setSemanaOffset(0); setDiaSeleccionado(todayDia); }}
                      style={{ fontSize: 12, fontWeight: 700, color: "white", background: "#2563eb", border: "1px solid #2563eb", borderRadius: 7, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" as const }}
                    >
                      Volver a semana actual ›
                    </button>
                  )}
                </div>
              </div>

              {/* Pestañas de días */}
              {!loadingPlan && (() => {
                const weekDates = getWeekDates(semanaMostrada, anioMostrado);
                // Lu=0 Ma=1 Mi=2 Ju=3 Vi=4 Sa=5 Do=6 en el array weekDates
                const DIA_IDX: Record<DiaSem, number> = { Lu: 0, Ma: 1, Mi: 2, Ju: 3, Vi: 4, Sa: 5, Do: 6 };
                return (
                  <div style={{ display: "flex", borderTop: "1px solid #e0eeff", borderBottom: "1px solid #e0eeff", overflowX: "auto", background: "white" }}>
                    {(["Lu","Ma","Mi","Ju","Vi","Sa","Do"] as DiaSem[]).map(dia => {
                      const count = planRefs.filter(r => r.ot.dia === dia && (!filtroArea || r.areaCodigo === filtroArea)).length;
                      const isHoy = semanaOffset === 0 && dia === todayDia;
                      const isActive = dia === diaSeleccionado;
                      const diaFecha = weekDates[DIA_IDX[dia]];
                      return (
                        <button key={dia} onClick={() => setDiaSeleccionado(dia)} style={{
                          flex: 1, minWidth: 48, padding: "8px 6px", border: "none",
                          borderBottom: isActive ? "3px solid #2563eb" : "3px solid transparent",
                          background: isActive ? "#eff6ff" : "transparent",
                          cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: isActive ? "#2563eb" : isHoy ? "#0f2847" : "#94a3b8", letterSpacing: "0.04em" }}>
                            {dia}{isHoy ? " ●" : ""}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "#2563eb" : isHoy ? "#0f2847" : "#64748b" }}>
                            {diaFecha.getDate()}
                          </span>
                          {count > 0
                            ? <span style={{ fontSize: 10, color: isActive ? "#60a5fa" : "#94a3b8" }}>{count} OT</span>
                            : <span style={{ fontSize: 10, color: "#e2e8f0" }}>—</span>
                          }
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Lista de OTs del día seleccionado */}
              <div style={{ padding: "10px 12px" }}>
              {(() => {
                const filtroNorm = filtroOT.trim().toLowerCase();
                const refsDelDia = planRefs.filter(r =>
                  r.ot.dia === diaSeleccionado &&
                  (!filtroNorm || r.ot.numeroOT.toLowerCase().includes(filtroNorm)) &&
                  (!filtroArea || r.areaCodigo === filtroArea)
                );
                if (loadingPlan) return null;
                if (refsDelDia.length === 0) {
                  return (
                    <div style={{ textAlign: "center", padding: "16px 0 8px", color: "#94a3b8", fontSize: 13 }}>
                      {filtroNorm
                        ? `Ninguna OT coincide con "${filtroOT}" para ${diaSeleccionado}`
                        : filtroArea
                          ? `Sin OTs del área seleccionada para ${diaSeleccionado}`
                          : <>Sin OTs programadas para {diaSeleccionado}
                            {semanaOffset === 0 && diaSeleccionado === todayDia && <><br /><span style={{ fontSize: 12 }}>Usa el botón de abajo para registrar una OT reactiva.</span></>}
                          </>
                      }
                    </div>
                  );
                }
                return null;
              })()}

              {planRefs.filter(r =>
                r.ot.dia === diaSeleccionado &&
                (!filtroOT.trim() || r.ot.numeroOT.toLowerCase().includes(filtroOT.trim().toLowerCase())) &&
                (!filtroArea || r.areaCodigo === filtroArea)
              ).map((ref, i) => {
                const ot = ref.ot;
                const esRecurrente = recurrentesNums.has(ot.numeroOT);
                // Para recurrentes sin vínculo propio, usar el ref del hermano ya registrado
                const refEfectivo = (!ot.ordenTrabajoId && esRecurrente && refRegistradaMap[ot.numeroOT])
                  ? refRegistradaMap[ot.numeroOT]
                  : ref;
                const yaRegistrada = !!ot.ordenTrabajoId || (esRecurrente && !!refRegistradaMap[ot.numeroOT]);
                // Auto-detectar guardia: tag contiene OPEPLANT o esGuardia marcado
                const esGuardia = ot.esGuardia || ot.tag?.includes("OPEPLANT");
                // Estado real de la OT madre (si ya se envió a revisión/cerró, no se debe
                // seguir ofreciendo el botón de cierre — solo informar que ya está hecho)
                const estadoMadreGuardia = guardiaEstadoMap[ot.numeroOT];
                const guardiaYaCerrada = !!estadoMadreGuardia && estadoMadreGuardia !== "borrador" && estadoMadreGuardia !== "en_proceso";
                const tipoColor = TIPO_COLOR[ot.tipoOT as TipoOT] ?? "#64748b";
                const estadoClr = ESTADO_CLR[ot.estado] ?? "#64748b";
                const estadoBg = ESTADO_BG[ot.estado] ?? "#f1f5f9";
                return (
                  <div key={i} style={{
                    border: yaRegistrada ? "1px solid #e2e8f0" : "1px solid #bfdbfe",
                    borderRadius: 10, padding: "12px 14px", marginBottom: 8,
                    background: yaRegistrada ? "#fafafa" : "white",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={S.badge(tipoColor)}>{ot.tipoOT}</span>
                          <span style={{ fontWeight: 800, fontSize: 13, color: "#1e293b" }}>{ot.numeroOT}</span>
                          <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{ot.tag}</span>
                          {areasEnPlan.length > 1 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", background: "#e0f2fe", borderRadius: 5, padding: "2px 6px" }}>
                              {ref.areaCodigo} · {areasEnPlan.find(a => a.codigo === ref.areaCodigo)?.nombre ?? ref.areaCodigo}
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 13, color: "#334155", marginBottom: 5, lineHeight: 1.4 }}>{ot.descripcion}</p>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          {ot.hhTotal ? <span style={{ fontSize: 11, color: "#94a3b8" }}>⏱ {ot.hhTotal}h</span> : null}
                          {ot.personas ? <span style={{ fontSize: 11, color: "#94a3b8" }}>👥 {ot.personas}</span> : null}
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>{ot.grupo}</span>
                          {ot.personalAsignado.length > 0 && (
                            <span style={{ fontSize: 11, color: "#64748b" }}>{ot.personalAsignado.join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                        {esGuardia ? (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6, padding: "2px 8px" }}>
                            🔄 TURNERO
                          </span>
                        ) : (
                          <span style={{ ...S.badge(estadoClr), background: estadoBg }}>{ot.estado.replace(/_/g, " ")}</span>
                        )}
                        {esGuardia ? (
                          guardiaYaCerrada ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                              <button
                                onClick={() => router.push("/ordenes/turnero")}
                                style={{ fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>
                                📋 Ver bitácora
                              </button>
                              <span style={{ fontSize: 10, fontWeight: 700, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" as const }}>
                                {estadoMadreGuardia === "concluido" ? "🔒 OT concluida" : estadoMadreGuardia === "revisado" ? "✓ Revisada" : "✓ Enviada a revisión"}
                              </span>
                            </div>
                          ) : yaRegistrada ? (
                            <button
                              onClick={() => router.push("/ordenes/reporte")}
                              style={{ fontSize: 12, color: "#16a34a", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>
                              #{ot.ordenTrabajoNum} Ver →
                            </button>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                              <button
                                onClick={() => router.push("/ordenes/turnero")}
                                style={{ ...S.btnPrimary(), padding: "7px 14px", fontSize: 13, background: "#d97706", borderColor: "#d97706" }}>
                                📋 Ver bitácora
                              </button>
                              {cierreSemanaHabilitado ? (
                                <button
                                  onClick={() => router.push(`/ordenes/reporte?buscar=${encodeURIComponent(ot.numeroOT)}`)}
                                  style={{ fontSize: 11, fontWeight: 700, color: "white", background: "#16a34a", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" as const }}>
                                  🔐 Cerrar OT de semana
                                </button>
                              ) : (
                                <span style={{ fontSize: 10, color: "#92400e", fontWeight: 600, textAlign: "right" as const }}>
                                  Cierre habilitado el domingo
                                </span>
                              )}
                            </div>
                          )
                        ) : yaRegistrada ? (
                          // OT ya registrada: mostrar según si es recurrente o no
                          esRecurrente ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px" }}>
                                🔁 RECURRENTE
                              </span>
                              {refEfectivo.ot.estado !== "completada" && refEfectivo.ot.estado !== "en_revision" && (
                                <button
                                  onClick={() => { setAvanceRef(refEfectivo); setAvanceForm({ fecha: shiftFecha, hhTrabajadas: "", tareas: [], tareaInput: "", observaciones: "", adjuntos: [] }); }}
                                  style={{ ...S.btnPrimary(), padding: "6px 12px", fontSize: 12 }}>
                                  + Avance del día
                                </button>
                              )}
                              {refEfectivo.ot.estado !== "completada" && refEfectivo.ot.estado !== "en_revision" ? (
                                <button
                                  onClick={() => enviarRevisionRecurrente(refEfectivo)}
                                  disabled={savingRevision}
                                  style={{ ...S.btnGreen(savingRevision), padding: "5px 10px", fontSize: 11 }}>
                                  {savingRevision ? "Enviando…" : "Enviar a revisión ✓"}
                                </button>
                              ) : (
                                <span style={{ fontSize: 10, fontWeight: 700, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 6, padding: "2px 8px" }}>
                                  ✓ Enviada a revisión
                                </span>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (!ot.ordenTrabajoId) return;
                                if (ot.ordenTrabajoId in otDetalles) {
                                  setOtDetalles(prev => { const n = { ...prev }; delete n[ot.ordenTrabajoId!]; return n; });
                                } else {
                                  cargarOtDetalle(ot.ordenTrabajoId);
                                }
                              }}
                              style={{ fontSize: 12, color: "#16a34a", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>
                              #{ot.ordenTrabajoNum} {ot.ordenTrabajoId && ot.ordenTrabajoId in otDetalles ? "▲ Ocultar" : "▼ Ver detalles"}
                            </button>
                          )
                        ) : ot.pasarNoche ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 6, padding: "4px 10px" }}>
                            🌙 En turno noche
                          </span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                            {esRecurrente && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px" }}>
                                🔁 RECURRENTE
                              </span>
                            )}
                            <button onClick={() => abrirRegistroPlan(ref, esRecurrente)}
                              style={{ ...S.btnPrimary(), padding: "7px 14px", fontSize: 13 }}>
                              {esRecurrente ? "Registrar 1er día →" : "Registrar →"}
                            </button>
                            {user && user.rol <= 3 && !esRecurrente && (
                              <button
                                onClick={() => { setPasarNocheRef(ref); setPasarNocheMotivo("Sin tiempo en el turno"); setPasarNocheNota(""); }}
                                style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", background: "none", border: "1px solid #c4b5fd", borderRadius: 6, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" as const }}>
                                🌙 Pasar a Noche
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Detalle OT ya registrada (OTs regulares del plan) ── */}
                    {!esGuardia && yaRegistrada && ot.ordenTrabajoId && ot.ordenTrabajoId in otDetalles && (() => {
                      const det = otDetalles[ot.ordenTrabajoId];
                      if (!det) return <div style={{ padding: "10px 0", fontSize: 12, color: "#94a3b8" }}>Cargando…</div>;
                      const hhTotal = det.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0);
                      return (
                        <div style={{ marginTop: 10, borderTop: "1px solid #d1fae5", paddingTop: 10 }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}>✓ OT registrada</span>
                            <span style={{ fontSize: 11, color: "#64748b" }}>{det.turno}</span>
                            {hhTotal > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#d97706" }}>{Math.round(hhTotal * 10) / 10} HH reales</span>}
                            <span style={{ fontSize: 11, color: "#64748b" }}>{det.tecnicos.map(t => t.nombreCompleto).join(", ")}</span>
                          </div>
                          {det.lineas.map((l, li) => (
                            <div key={li} style={{ background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0", padding: "8px 10px", marginBottom: 6 }}>
                              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: TIPO_COLOR[l.tipoOT as TipoOT] ?? "#64748b", fontFamily: "monospace" }}>{l.tipoOT}</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", fontFamily: "monospace" }}>{l.tag}</span>
                                {l.descripcionEquipo && <span style={{ fontSize: 11, color: "#64748b" }}>{l.descripcionEquipo}</span>}
                              </div>
                              {l.sintoma && <p style={{ fontSize: 11, color: "#475569", fontStyle: "italic", marginBottom: 2 }}>Síntoma: {l.sintoma}</p>}
                              {l.descripcionTrabajo && <p style={{ fontSize: 11, color: "#475569", marginBottom: 2 }}>{l.descripcionTrabajo}</p>}
                              {l.resolucionAplicada && <p style={{ fontSize: 11, color: "#16a34a" }}>✓ {l.resolucionAplicada}</p>}
                              {l.estadoFinal && (() => {
                                const eo = ESTADO_FINAL_OPTIONS.find(o => o.value === l.estadoFinal);
                                return eo ? <span style={{ fontSize: 10, fontWeight: 700, color: eo.color, background: eo.color + "15", borderRadius: 5, padding: "2px 7px", marginTop: 3, display: "inline-block" }}>{eo.label}</span> : null;
                              })()}
                            </div>
                          ))}
                          <button onClick={() => router.push("/ordenes/reporte")}
                            style={{ fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>
                            Ver OT completa en reporte →
                          </button>
                          <button onClick={() => setOtDetalles(prev => { const n = { ...prev }; delete n[ot.ordenTrabajoId!]; return n; })}
                            style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", marginLeft: 12 }}>
                            Ocultar
                          </button>
                        </div>
                      );
                    })()}

                    {/* ── Mini-form Avance Diario (recurrentes) ── */}
                    {avanceRef?.planId === ref.planId && avanceRef?.ot.numeroOT === ot.numeroOT && (
                      <AvanceDiarioMiniForm
                        titulo={`+ Avance del día ${diaSeleccionado}`}
                        form={avanceForm}
                        onChange={setAvanceForm}
                        cargandoAdj={cargandoAdjAvance}
                        onCargandoAdjChange={setCargandoAdjAvance}
                        onCancelar={() => setAvanceRef(null)}
                        onGuardar={confirmarAvanceDiario}
                        guardando={savingAvance}
                      />
                    )}

                    {/* Mini-form Pasar a Noche (inline, solo para esta OT) */}
                    {pasarNocheRef?.planId === ref.planId && pasarNocheRef?.ot.numeroOT === ot.numeroOT && (
                      <div style={{ marginTop: 10, borderTop: "1px solid #ede9fe", paddingTop: 10, background: "#faf5ff", borderRadius: "0 0 10px 10px", padding: "10px 12px" }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>🌙 ¿Por qué pasa al turno noche?</p>
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 8 }}>
                          {["Sin tiempo en el turno", "Falta de materiales", "Requiere condición especial", "Continúa trabajo iniciado"].map(m => (
                            <button key={m} onClick={() => setPasarNocheMotivo(m)}
                              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, border: `1px solid ${pasarNocheMotivo === m ? "#7c3aed" : "#e2e8f0"}`, background: pasarNocheMotivo === m ? "#ede9fe" : "white", color: pasarNocheMotivo === m ? "#7c3aed" : "#64748b", cursor: "pointer", fontWeight: pasarNocheMotivo === m ? 700 : 400 }}>
                              {m}
                            </button>
                          ))}
                        </div>
                        <input
                          value={pasarNocheNota}
                          onChange={e => setPasarNocheNota(e.target.value)}
                          placeholder="Nota adicional para el supervisor nocturno (opcional)..."
                          style={{ width: "100%", border: "1px solid #ddd6fe", borderRadius: 6, padding: "6px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" as const, marginBottom: 8 }}
                        />
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button onClick={() => setPasarNocheRef(null)}
                            style={{ fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", color: "#64748b" }}>
                            Cancelar
                          </button>
                          <button onClick={confirmarPasarNoche} disabled={savingNoche}
                            style={{ fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 6, border: "none", background: savingNoche ? "#a78bfa" : "#7c3aed", color: "white", cursor: savingNoche ? "not-allowed" : "pointer" }}>
                            {savingNoche ? "Guardando…" : "Confirmar 🌙"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>{/* fin padding-div */}
            </div>{/* fin card */}

            {/* Nueva OT Reactiva */}
            <button onClick={abrirRegistroReactivo}
              style={{ width: "100%", padding: "14px 18px", border: "2px dashed #fed7aa", borderRadius: 12, background: "#fffbeb", cursor: "pointer", textAlign: "left" as const }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>⚡</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e" }}>Nueva OT Reactiva (CMR / CMP)</div>
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>Falla o trabajo no planificado · se registra en KPI reactivo (≤ 15%)</div>
                </div>
              </div>
            </button>
          </>
        )}

        {/* ════════════════ VISTA REGISTRO ═════════════════════════════════ */}
        {view === "registro" && (
          <>
            {/* Contexto banner */}
            {form.origenPlan ? (
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
                <span style={S.badge("#2563eb")}>PLAN</span>
                <span style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600, flex: 1 }}>
                  OT {form.otJdeNumero} · {form.lineas[0]?.tipoOT} · {form.lineas[0]?.tag}
                </span>
                <button onClick={volverAlInicio} style={{ fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer" }}>← Plan</button>
              </div>
            ) : (
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
                <span style={S.badge("#d97706")}>⚡ REACTIVA</span>
                <span style={{ fontSize: 13, color: "#92400e", flex: 1 }}>OT no planificada — CMR / CMP</span>
                <button onClick={volverAlInicio} style={{ fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer" }}>← Plan</button>
              </div>
            )}

            <Steps step={step} />

            {/* ── Step 1: Encabezado ── */}
            {step === 1 && (
              <>
                <div style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 16 }}>Encabezado</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px", marginBottom: 13 }}>
                    <div>
                      <label style={S.label}>Fecha</label>
                      <input type="date" value={form.fecha} onChange={e => patchForm({ fecha: e.target.value })} style={S.input} />
                      {errs.fecha && <p style={S.err}>{errs.fecha}</p>}
                    </div>
                    <div>
                      <label style={S.label}>Turno</label>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {TURNOS.map(t => {
                          const a = form.turno === t;
                          return <button key={t} type="button" onClick={() => patchForm({ turno: t })}
                            style={{ padding: "7px 11px", borderRadius: 7, fontSize: 12, cursor: "pointer", border: a ? "2px solid #2563eb" : "1px solid #e2e8f0", background: a ? "#eff6ff" : "white", color: a ? "#1d4ed8" : "#64748b", fontWeight: a ? 700 : 400 }}>{t}</button>;
                        })}
                      </div>
                      {errs.turno && <p style={S.err}>{errs.turno}</p>}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: form.origenPlan ? "1fr" : "1fr auto", gap: "0 12px", alignItems: "start" }}>
                    <div>
                      <label style={S.label}>Área</label>
                      <select value={form.areaCodigo} onChange={e => patchForm({ areaCodigo: e.target.value, tecnicos: [] })} style={S.select}>
                        <option value="">— Seleccionar —</option>
                        {areas.map(a => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>)}
                      </select>
                      {errs.areaCodigo && <p style={S.err}>{errs.areaCodigo}</p>}
                    </div>
                    {!form.origenPlan && (
                      <div>
                        <label style={S.label}>N° OT <span style={{ color: "#94a3b8", fontWeight: 400 }}>(opc.)</span></label>
                        <input
                          type="text"
                          value={form.otJdeNumero}
                          onChange={e => {
                            const val = e.target.value.toUpperCase();
                            patchForm({ otJdeNumero: val });
                            detectarOtMadre(val);
                            detectarOtReactivaAbierta(val);
                          }}
                          placeholder="100234"
                          style={{ ...S.input, fontFamily: "monospace", letterSpacing: "0.05em", width: 150, borderColor: otMadreInfo ? "#d97706" : otReactivaAbierta ? "#2563eb" : undefined }}
                        />
                        {otMadreInfo && (
                          <div style={{ marginTop: 6, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 10px" }}>
                            <p style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 2 }}>
                              🔄 OT OPEPLANT detectada
                            </p>
                            <p style={{ fontSize: 11, color: "#b45309", lineHeight: 1.5 }}>
                              Esta OT se vinculará como entrada de bitácora de la semana bajo la <strong>OT {form.otJdeNumero}</strong>.
                              No aparecerá suelta en el panel del supervisor — se verá agrupada en el Turnero.
                            </p>
                          </div>
                        )}
                        {!otMadreInfo && otReactivaAbierta && (
                          <div style={{ marginTop: 6, background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 8, padding: "8px 10px" }}>
                            <p style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", marginBottom: 2 }}>
                              🔓 Ya existe una OT abierta con este número
                            </p>
                            <p style={{ fontSize: 11, color: "#1e40af", lineHeight: 1.5, marginBottom: 6 }}>
                              Creada el {new Date(otReactivaAbierta.fecha).toLocaleDateString("es-BO")}
                              {otReactivaAbierta.tecnicos.length > 0 && <> · Técnicos: {otReactivaAbierta.tecnicos.map(t => t.nombreCompleto).join(", ")}</>}.
                              {" "}Continúa el registro aquí en vez de crear una OT nueva.
                            </p>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                              <button type="button"
                                onClick={() => { setAvanceReactivaRef({ id: otReactivaAbierta.id, numeroOT: otReactivaAbierta.numeroOT }); setAvanceReactivaForm({ fecha: shiftFecha, hhTrabajadas: "", tareas: [], tareaInput: "", observaciones: "", adjuntos: [] }); }}
                                style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "white", cursor: "pointer" }}>
                                + Agregar avance del día →
                              </button>
                              <button type="button"
                                onClick={() => enviarRevisionReactiva({ id: otReactivaAbierta.id, numeroOT: otReactivaAbierta.numeroOT })}
                                disabled={enviandoRevisionReactiva}
                                style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 6, border: "1px solid #16a34a", background: "white", color: "#16a34a", cursor: "pointer" }}>
                                {enviandoRevisionReactiva ? "Enviando…" : "Enviar a revisión ✓"}
                              </button>
                            </div>
                          </div>
                        )}
                        {avanceReactivaRef?.id === otReactivaAbierta?.id && (
                          <AvanceDiarioMiniForm
                            titulo="+ Avance del día — OT reactiva"
                            form={avanceReactivaForm}
                            onChange={setAvanceReactivaForm}
                            cargandoAdj={cargandoAdjAvanceReactiva}
                            onCargandoAdjChange={setCargandoAdjAvanceReactiva}
                            onCancelar={() => setAvanceReactivaRef(null)}
                            onGuardar={confirmarAvanceReactiva}
                            guardando={savingAvanceReactiva}
                            accentColor="#2563eb"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <TecnicosPanel
                  areaCodigo={form.areaCodigo}
                  tecnicos={form.tecnicos}
                  personalAsignadoPlan={[]}
                  onChange={tecnicos => patchForm({ tecnicos })}
                  error={errs.tecnicos}
                />

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={() => { if (validateStep1()) setStep(2); }} style={S.btnPrimary()}>Continuar →</button>
                </div>
              </>
            )}

            {/* ── Step 2: Trabajo ── */}
            {step === 2 && (
              <>
                {/* ── Panel técnicos (siempre visible en step 2 para plan OTs, o si step 1 fue saltado) ── */}
                <TecnicosPanel
                  areaCodigo={form.areaCodigo}
                  tecnicos={form.tecnicos}
                  personalAsignadoPlan={form.origenPlan ? (planRefs.find(r => r.planId === form.programacionSemanalId && r.ot.numeroOT === form.otJdeNumero)?.ot.personalAsignado ?? []) : []}
                  onChange={tecnicos => patchForm({ tecnicos })}
                  error={errs.tecnicos}
                />

                {/* Lineas confirmadas */}
                {form.lineas.map((l, idx) => {
                  if (editLinea && editIdx === idx) return null; // mostrar editor abajo
                  const tipoColor = l.tipoOT ? TIPO_COLOR[l.tipoOT as TipoOT] : "#e2e8f0";
                  return (
                    <div key={l.id} style={{ ...S.card, borderLeft: `4px solid ${tipoColor}`, opacity: editLinea ? 0.4 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                            <span style={{ fontWeight: 800, fontSize: 14 }}>{l.tag}</span>
                            {l.tipoOT && <span style={S.badge(tipoColor)}>{l.tipoOT}</span>}
                            {l.criticidad && <span style={S.badge(CRIT_COLOR[l.criticidad] ?? "#64748b")}>Crit. {l.criticidad}</span>}
                          </div>
                          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>{l.descripcionEquipo}</p>
                          {l.descripcionTrabajo && <p style={{ fontSize: 12, color: "#475569" }}>{l.descripcionTrabajo}</p>}
                          {isCorrectivo(l.tipoOT) && l.sintoma && <p style={{ fontSize: 12, color: "#475569" }}>{l.sintoma}{l.causaProbable ? ` → ${l.causaProbable}` : ""}</p>}
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                            {l.tiempoRealHrs && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>⏱ {l.tiempoRealHrs} HH</span>}
                            {l.estadoFinal && (() => {
                              const eo = ESTADO_FINAL_OPTIONS.find(o => o.value === l.estadoFinal);
                              return eo ? <span style={{ fontSize: 10, fontWeight: 700, color: eo.color, background: eo.color + "15", borderRadius: 5, padding: "2px 7px" }}>{eo.label}</span> : null;
                            })()}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <button type="button" onClick={() => openEdit(idx)} disabled={!!editLinea}
                            style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 12 }}>Editar</button>
                          {!(form.origenPlan && idx === 0) && (
                            <button type="button" onClick={() => removeLinea(idx)} disabled={!!editLinea}
                              style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 12, color: "#dc2626", borderColor: "#fecaca" }}>✕</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Editor inline */}
                {editLinea && (
                  <LineaEditor
                    linea={editLinea}
                    area={form.areaCodigo}
                    isNew={isNewLinea}
                    soloCorrectivos={!form.origenPlan}
                    fecha={form.fecha}
                    onFechaChange={fecha => patchForm({ fecha })}
                    onConfirm={l => confirmLinea(l)}
                    onCancel={cancelLinea}
                  />
                )}

                {!editLinea && (
                  <button type="button"
                    onClick={() => { setEditLinea(newLinea()); setEditIdx(null); setIsNewLinea(true); }}
                    style={{ width: "100%", padding: 13, marginBottom: 12, border: "2px dashed #cbd5e1", borderRadius: 10, background: "white", color: "#2563eb", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    + Agregar{form.origenPlan ? " otro" : ""} equipo intervenido
                  </button>
                )}

                {errs.lineas && <p style={{ ...S.err, marginBottom: 10 }}>{errs.lineas}</p>}
                {errs.edit && <p style={{ color: "#d97706", fontSize: 12, marginBottom: 10 }}>⚠ {errs.edit}</p>}

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button onClick={() => { cancelLinea(); setStep(1); }} style={S.btnGhost}>← Encabezado</button>
                  <button onClick={() => { if (validateStep2()) setStep(3); }} style={S.btnPrimary()}>Revisar →</button>
                </div>
              </>
            )}

            {/* ── Step 3: Revisión ── */}
            {step === 3 && (
              <>
                <div style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 12 }}>Resumen</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 22px" }}>
                    <div><span style={S.label}>Fecha</span><p style={{ fontSize: 14, color: "#1e293b" }}>{form.fecha}</p></div>
                    <div><span style={S.label}>Turno</span><p style={{ fontSize: 14, color: "#1e293b" }}>{form.turno}</p></div>
                    <div><span style={S.label}>Área</span><p style={{ fontSize: 14, color: "#1e293b" }}>{areas.find(a => a.codigo === form.areaCodigo)?.nombre ?? form.areaCodigo}</p></div>
                    <div><span style={S.label}>Técnicos</span><p style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5 }}>{form.tecnicos.map(t => t.nombreCompleto).join(", ")}</p></div>
                    {form.origenPlan ? (
                      <>
                        <div><span style={S.label}>Origen</span><span style={S.badge("#2563eb")}>PLAN SEMANAL</span></div>
                        <div><span style={S.label}>OT Plan</span><p style={{ fontSize: 14, color: "#1e293b", fontFamily: "monospace", fontWeight: 700 }}>{form.otJdeNumero}</p></div>
                      </>
                    ) : (
                      <div><span style={S.label}>Tipo</span><span style={S.badge("#d97706")}>⚡ REACTIVA</span></div>
                    )}
                  </div>
                </div>

                <div style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2847", marginBottom: 12 }}>Equipos intervenidos ({form.lineas.length})</div>
                  {form.lineas.map((l, i) => (
                    <div key={l.id} style={{ borderLeft: `3px solid ${l.tipoOT ? TIPO_COLOR[l.tipoOT as TipoOT] : "#e2e8f0"}`, paddingLeft: 12, marginBottom: i < form.lineas.length - 1 ? 14 : 0, paddingBottom: i < form.lineas.length - 1 ? 14 : 0, borderBottom: i < form.lineas.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                        <span style={{ fontWeight: 800, fontSize: 13 }}>{l.tag}</span>
                        {l.tipoOT && <span style={S.badge(TIPO_COLOR[l.tipoOT as TipoOT])}>{l.tipoOT}</span>}
                      </div>
                      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>{l.descripcionEquipo}</p>
                      {isCorrectivo(l.tipoOT) && l.sintoma && <p style={{ fontSize: 12, color: "#475569" }}>Síntoma: {l.sintoma}</p>}
                      {isCorrectivo(l.tipoOT) && l.causaProbable && <p style={{ fontSize: 12, color: "#475569" }}>Causa: {l.causaProbable}</p>}
                      {l.descripcionTrabajo && <p style={{ fontSize: 12, color: "#475569" }}>{l.descripcionTrabajo}</p>}
                      {l.resolucionAplicada && <p style={{ fontSize: 12, color: "#475569" }}>Resolución: {l.resolucionAplicada}</p>}
                      {isPreventivo(l.tipoOT) && l.tareasEjecutadas.length > 0 && <ul style={{ margin: "3px 0", paddingLeft: 16 }}>{l.tareasEjecutadas.map((t, ti) => <li key={ti} style={{ fontSize: 12, color: "#64748b" }}>{t}</li>)}</ul>}
                      <div style={{ display: "flex", gap: 12, marginTop: 2, alignItems: "center" }}>
                        {l.tiempoEstimadoHrs && <span style={{ fontSize: 12, color: "#94a3b8" }}>Est: {l.tiempoEstimadoHrs}h</span>}
                        {l.tiempoRealHrs && <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>Real: {l.tiempoRealHrs}HH</span>}
                        {l.estadoFinal && (() => {
                          const eo = ESTADO_FINAL_OPTIONS.find(o => o.value === l.estadoFinal);
                          return eo ? <span style={{ fontSize: 10, fontWeight: 700, color: eo.color, background: eo.color + "15", borderRadius: 5, padding: "2px 7px" }}>{eo.label}</span> : null;
                        })()}
                      </div>
                      {l.observaciones && <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 2 }}>{l.observaciones}</p>}
                    </div>
                  ))}
                </div>

                {submitErr && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "11px 14px", marginBottom: 12 }}>
                    <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Error al guardar</p>
                    <p style={{ color: "#dc2626", fontSize: 12 }}>{submitErr}</p>
                  </div>
                )}

                <div style={{ ...S.card, background: "#f8fafc" }}>
                  {form.esRecurrente ? (
                    <>
                      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 13px", marginBottom: 12 }}>
                        <p style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 700, marginBottom: 3 }}>🔁 OT Recurrente — acumula HH durante la semana</p>
                        <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                          Se guardará en estado <strong>En Proceso</strong>. Los días siguientes agregas avances diarios desde la tarjeta del plan.
                          Al finalizar la semana, usa <strong>Enviar a revisión</strong> desde la tarjeta para cerrar todo el ciclo.
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <button onClick={() => setStep(2)} style={S.btnGhost} disabled={submitting}>← Editar</button>
                        <button onClick={() => submit("en_proceso")} style={{ ...S.btnPrimary(submitting), marginLeft: "auto" }} disabled={submitting}>
                          {submitting ? "Guardando..." : "Guardar 1er día →"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginBottom: 12 }}>
                        <strong style={{ color: "#1e293b" }}>Borrador</strong>: guarda sin enviar.{" "}
                        {!form.origenPlan && <><strong style={{ color: "#2563eb" }}>Guardar y continuar</strong>: deja la OT abierta para agregar avances otro día.{" "}</>}
                        <strong style={{ color: "#1e293b" }}>Enviar a revisión</strong>: el supervisor recibirá para aprobar.
                        {form.origenPlan && <><br /><strong style={{ color: "#1d4ed8" }}>El estado en el plan semanal se actualizará automáticamente.</strong></>}
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <button onClick={() => setStep(2)} style={S.btnGhost} disabled={submitting}>← Editar</button>
                        <button onClick={() => submit("borrador")} style={{ ...S.btnOutline, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
                          {submitting ? "Guardando..." : "💾 Borrador"}
                        </button>
                        {!form.origenPlan && (
                          <button onClick={() => submit("en_proceso")} style={{ ...S.btnPrimary(submitting), marginLeft: "auto" }} disabled={submitting}>
                            {submitting ? "Guardando..." : "Guardar y continuar →"}
                          </button>
                        )}
                        <button onClick={() => submit("pendiente_revision")} style={{ ...S.btnGreen(submitting), marginLeft: form.origenPlan ? "auto" : undefined }} disabled={submitting}>
                          {submitting ? "Enviando..." : "Enviar a revisión ✓"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
