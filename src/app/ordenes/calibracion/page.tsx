"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import AppHeader from "@/components/AppHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

type PuntoForm = {
  lecturaPatron: string;
  lecturaInstrumento: string;
  tolerancia: string;
};

type PuntoAntesForm = {
  lecturaPatron: string;
  lecturaInstrumento: string;
  tolerancia: string;
};

type FormData = {
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  patronIds: string[];      // multi-patrón (nuevo)
  patronCodigos: string[];  // multi-patrón
  patronId: string;         // legado — se llena con patronIds[0]
  patronCodigo: string;     // legado
  tecnicoId: string;
  tecnicoNombre: string;
  supervisorId: string;
  supervisorNombre: string;
  fecha: string;
  puntos: PuntoForm[];
  puntosAntes: PuntoAntesForm[];
  unidad: string;
  resultadoManual: "APROBADO" | "RECHAZADO" | "AJUSTADO" | "";
  temperatura: string;
  humedad: string;
  observaciones: string;
  otAsociada: string;
  stickerImpreso: boolean;
  estado: string;
  tecnicoFirma: string;
  supervisorFirma: string;
};

type PatronDoc = {
  _id: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  fechaUltimaCalibracion: string;
  fechaVencimiento: string;
  frecuenciaCalibracion: string;
  rangoMin?: number;
  rangoMax?: number;
  precision?: string;
  ubicacion?: string;
  activo: boolean;
};

type PatronForm = {
  codigo: string; descripcion: string; tipo: string;
  marca: string; modelo: string; numeroSerie: string;
  fechaUltimaCalibracion: string; fechaVencimiento: string;
  frecuenciaCalibracion: string; rangoMin: string; rangoMax: string;
  precision: string; ubicacion: string; activo: boolean;
};

type EquipoResult = { tag: string; descripcion: string };
type UserOpt = { _id: string; nombreCompleto: string; areaTrabajo?: string; areas?: string[] };

type RegistroDoc = {
  _id: string;
  numeroCertificado: string;
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  patronId?: string;
  patronCodigo: string;
  tecnicoNombre: string;
  supervisorId?: string;
  supervisorNombre?: string;
  fecha: string;
  turno: string;
  unidad?: string;
  puntos: {
    lecturaPatron: number;
    lecturaInstrumento: number;
    error: number;
    tolerancia: number;
    aprueba: boolean;
  }[];
  puntosAntes?: { lecturaPatron: number; lecturaInstrumento: number; error: number; tolerancia: number; aprueba: boolean; }[];
  resultadoGeneral: string;
  observaciones?: string;
  temperatura?: number;
  humedad?: number;
  stickerImpreso: boolean;
  otAsociada?: string;
  areaCodigo: string;
  estado?: string;
  tecnicoFirma?: string;
  supervisorFirma?: string;
  createdAt?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const RESULTADO_COLOR: Record<string, string> = {
  APROBADO: "#16a34a",
  RECHAZADO: "#dc2626",
  AJUSTADO: "#d97706",
};

const TURNO_LIST = ["Diurno", "Nocturno", "Parada de Planta", "Otro"];

const TIPOS_VARIABLE = [
  "Presión", "Temperatura", "Flujo", "Nivel",
  "pH", "Conductividad", "Posición", "Velocidad", "Otro",
];

const STEP_LABELS = ["Instrumento", "Patrón", "Puntos", "Firma Técnico", "Revisión"];

const TIPOS_PATRON = [
  "Presión", "Temperatura", "Flujo", "Nivel",
  "pH", "Conductividad", "ORP", "Gas", "Sonido",
  "Masa", "Multifunción", "Otro",
];
const FRECUENCIAS_CAL = ["3 meses", "6 meses", "1 año", "2 años"];

const UNIDADES_VARIABLE: Record<string, string[]> = {
  "Presión":       ["kPa", "psi", "bar", "mbar", "inH₂O", "mmHg", "MPa"],
  "Temperatura":   ["°C", "°F", "K"],
  "Flujo":         ["m³/h", "L/min", "L/h", "GPM"],
  "Nivel":         ["m", "cm", "mm", "%"],
  "pH":            ["pH"],
  "Conductividad": ["µS/cm", "mS/cm"],
  "ORP":           ["mV"],
  "Gas":           ["ppm", "% vol", "% LEL", "mg/m³"],
  "Sonido":        ["dB"],
  "Masa":          ["kg", "g", "t", "lb"],
  "Velocidad":     ["RPM", "m/s", "Hz"],
  "Posición":      ["mm", "cm", "%"],
  "Otro":          ["—"],
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormData {
  return {
    tag: "", descripcionInstrumento: "", tipoVariable: "",
    patronIds: [], patronCodigos: [],
    patronId: "", patronCodigo: "",
    tecnicoId: "", tecnicoNombre: "",
    supervisorId: "", supervisorNombre: "",
    fecha: todayStr(),
    puntos: [{ lecturaPatron: "", lecturaInstrumento: "", tolerancia: "" }],
    puntosAntes: [],
    unidad: "",
    temperatura: "", humedad: "",
    resultadoManual: "", observaciones: "", otAsociada: "", stickerImpreso: false,
    estado: "revision",
    tecnicoFirma: "",
    supervisorFirma: "",
  };
}

function emptyPatronForm(): PatronForm {
  return {
    codigo: "", descripcion: "", tipo: "", marca: "", modelo: "",
    numeroSerie: "", fechaUltimaCalibracion: todayStr(), fechaVencimiento: "",
    frecuenciaCalibracion: "1 año", rangoMin: "", rangoMax: "",
    precision: "", ubicacion: "", activo: true,
  };
}

function calcError(p: PuntoForm): number | null {
  const lp = Number(p.lecturaPatron);
  const li = Number(p.lecturaInstrumento);
  if (p.lecturaPatron === "" || p.lecturaInstrumento === "") return null;
  return li - lp;
}

function calcAprueba(p: PuntoForm): boolean | null {
  const err = calcError(p);
  if (err === null || p.tolerancia === "") return null;
  return Math.abs(err) <= Number(p.tolerancia);
}

function calcErrorAntes(p: PuntoAntesForm): number | null {
  if (p.lecturaPatron === "" || p.lecturaInstrumento === "") return null;
  return Number(p.lecturaInstrumento) - Number(p.lecturaPatron);
}

function calcApruebaAntes(p: PuntoAntesForm): boolean | null {
  const err = calcErrorAntes(p);
  if (err === null || p.tolerancia === "") return null;
  return Math.abs(err) <= Number(p.tolerancia);
}

function calcResultadoAuto(puntos: PuntoForm[]): "APROBADO" | "RECHAZADO" | null {
  if (puntos.length === 0) return null;
  const filled = puntos.filter(
    (p) => p.lecturaPatron !== "" && p.lecturaInstrumento !== "" && p.tolerancia !== ""
  );
  if (filled.length === 0) return null;
  return filled.every((p) => calcAprueba(p) === true) ? "APROBADO" : "RECHAZADO";
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" });
}

function isVencido(fechaVencimiento: string): boolean {
  return new Date(fechaVencimiento) < new Date();
}

function isProximoAVencer(fechaVencimiento: string): boolean {
  const venc = new Date(fechaVencimiento);
  const now = new Date();
  const diff = (venc.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 30;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: { minHeight: "100vh", background: "#f1f5f9" },
  wrap: { maxWidth: 760, margin: "0 auto", padding: "20px 16px 56px" },
  card: { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 12 },
  label: { display: "block" as const, fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase" as const, marginBottom: 5 },
  input: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white" },
  select: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white", cursor: "pointer" },
  textarea: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, resize: "vertical" as const, minHeight: 72, background: "white" },
  badge: (color: string) => ({ display: "inline-block" as const, background: color + "18", color, border: `1px solid ${color}40`, borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" as const }),
  btnPrimary: { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGreen: { background: "#16a34a", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" as const },
  btnGhost: { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const },
  btnOutline: { background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" as const },
  err: { color: "#dc2626", fontSize: 12, marginTop: 4 } as React.CSSProperties,
};

// ─── Patron Form Inline ───────────────────────────────────────────────────────

type PatronFormInlineProps = {
  form: PatronForm;
  setForm: React.Dispatch<React.SetStateAction<PatronForm>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
  isEdit: boolean;
};

function PatronFormInline({ form, setForm, onSave, onCancel, saving, error, isEdit }: PatronFormInlineProps) {
  const upd = (key: keyof PatronForm, val: string | boolean) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 10 }}>
        <div>
          <label style={S.label}>Código *</label>
          <input style={S.input} value={form.codigo} onChange={(e) => upd("codigo", e.target.value)} placeholder="Ej: PAT-001" />
        </div>
        <div>
          <label style={S.label}>Tipo *</label>
          <select style={S.select} value={form.tipo} onChange={(e) => upd("tipo", e.target.value)}>
            <option value="">Seleccionar...</option>
            {TIPOS_PATRON.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Descripción *</label>
          <input style={S.input} value={form.descripcion} onChange={(e) => upd("descripcion", e.target.value)} placeholder="Descripción del patrón" />
        </div>
        <div>
          <label style={S.label}>Marca *</label>
          <input style={S.input} value={form.marca} onChange={(e) => upd("marca", e.target.value)} placeholder="Ej: FLUKE" />
        </div>
        <div>
          <label style={S.label}>Modelo *</label>
          <input style={S.input} value={form.modelo} onChange={(e) => upd("modelo", e.target.value)} placeholder="Ej: 744" />
        </div>
        <div>
          <label style={S.label}>N° Serie *</label>
          <input style={S.input} value={form.numeroSerie} onChange={(e) => upd("numeroSerie", e.target.value)} placeholder="N° de serie" />
        </div>
        <div>
          <label style={S.label}>Frec. calibración *</label>
          <select style={S.select} value={form.frecuenciaCalibracion} onChange={(e) => upd("frecuenciaCalibracion", e.target.value)}>
            {FRECUENCIAS_CAL.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Última calibración *</label>
          <input type="date" style={{ ...S.input, width: "auto" }} value={form.fechaUltimaCalibracion} onChange={(e) => upd("fechaUltimaCalibracion", e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Vencimiento *</label>
          <input type="date" style={{ ...S.input, width: "auto" }} value={form.fechaVencimiento} onChange={(e) => upd("fechaVencimiento", e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Rango mín</label>
          <input type="number" step="any" style={S.input} value={form.rangoMin} onChange={(e) => upd("rangoMin", e.target.value)} placeholder="0" />
        </div>
        <div>
          <label style={S.label}>Rango máx</label>
          <input type="number" step="any" style={S.input} value={form.rangoMax} onChange={(e) => upd("rangoMax", e.target.value)} placeholder="100" />
        </div>
        <div>
          <label style={S.label}>Precisión</label>
          <input style={S.input} value={form.precision} onChange={(e) => upd("precision", e.target.value)} placeholder="Ej: ±0.1%" />
        </div>
        <div>
          <label style={S.label}>Ubicación</label>
          <input style={S.input} value={form.ubicacion} onChange={(e) => upd("ubicacion", e.target.value)} placeholder="Ubicación" />
        </div>
        {isEdit && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={form.activo} onChange={(e) => upd("activo", e.target.checked)} />
              <span style={{ fontSize: 12, color: "#1e293b" }}>Activo</span>
            </label>
          </div>
        )}
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button style={S.btnGhost} onClick={onCancel}>Cancelar</button>
        <button
          style={{ ...S.btnGreen, opacity: saving ? 0.7 : 1, fontSize: 13 }}
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear patrón"}
        </button>
      </div>
    </div>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12px 0 20px" }}>
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        const circleColor = done ? "#16a34a" : active ? "#2563eb" : "#cbd5e1";
        const textColor = done ? "#16a34a" : active ? "#2563eb" : "#94a3b8";
        return (
          <div key={n} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", background: circleColor,
                color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
              }}>
                {done ? "✓" : n}
              </div>
              <span style={{ fontSize: 10, color: textColor, fontWeight: active ? 700 : 500, whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div style={{
                width: 40, height: 2, background: done ? "#16a34a" : "#e2e8f0",
                marginBottom: 18, flexShrink: 0,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Signature Selector Component ─────────────────────────────────────────────

type SignatureSelectorProps = {
  value: string;
  onChange: (val: string) => void;
  label: string;
};

function SignatureSelector({ value, onChange, label }: SignatureSelectorProps) {
  const [mode, setMode] = useState<"dibujar" | "subir">("dibujar");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f2847";

    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ("touches" in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const tx = ("touches" in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const ty = ("touches" in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(tx, ty);
    ctx.stroke();
    e.preventDefault();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    saveCanvas();
  };

  const saveCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onChange(dataUrl);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result && typeof event.target.result === "string") {
        onChange(event.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 10, padding: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>{label}</label>
      
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid",
            fontSize: 12,
            cursor: "pointer",
            background: mode === "dibujar" ? "#2563eb" : "white",
            color: mode === "dibujar" ? "white" : "#475569",
            borderColor: mode === "dibujar" ? "#2563eb" : "#cbd5e1",
          }}
          onClick={() => { setMode("dibujar"); onChange(""); }}
        >
          ✍️ Dibujar Firma
        </button>
        <button
          type="button"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid",
            fontSize: 12,
            cursor: "pointer",
            background: mode === "subir" ? "#2563eb" : "white",
            color: mode === "subir" ? "white" : "#475569",
            borderColor: mode === "subir" ? "#2563eb" : "#cbd5e1",
          }}
          onClick={() => { setMode("subir"); onChange(""); }}
        >
          📁 Subir Imagen
        </button>
      </div>

      {mode === "dibujar" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <canvas
            ref={canvasRef}
            width={400}
            height={150}
            style={{ border: "1px solid #cbd5e1", background: "white", borderRadius: 8, cursor: "crosshair", touchAction: "none", width: "100%", height: 150 }}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 12, cursor: "pointer" }} onClick={clearCanvas}>Limpiar Lienzo</button>
          </div>
        </div>
      )}

      {mode === "subir" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="file" accept="image/*" onChange={handleFileUpload} style={{ fontSize: 13 }} />
          <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>Formatos permitidos: PNG, JPG, JPEG.</p>
        </div>
      )}

      {value && (
        <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 6 }}>Vista previa de la firma:</span>
          <img src={value} alt="Firma" style={{ maxHeight: 60, border: "1px solid #f1f5f9", background: "white", padding: 4, borderRadius: 4 }} />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CalibracionPage() {
  const [view, setView] = useState<"lista" | "nuevo" | "detalle" | "patrones">("lista");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [formErrors, setFormErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Aprobación Supervisor
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [supervisorErrorId, setSupervisorErrorId] = useState("");
  const [supervisorErrorFirma, setSupervisorErrorFirma] = useState("");
  const [shouldScrollToSupervisor, setShouldScrollToSupervisor] = useState(false);
  const supervisorFormRef = useRef<HTMLDivElement | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; nombre: string; rol: number } | null>(null);

  // Lista
  const [registros, setRegistros] = useState<RegistroDoc[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);
  const [filterTag, setFilterTag] = useState("");
  const [filterResultado, setFilterResultado] = useState("");

  // Detalle
  const [detalle, setDetalle] = useState<RegistroDoc | null>(null);
  const [patchingSticker, setPatchingSticker] = useState(false);

  // Selección múltiple para stickers
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectHoy = () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const ids = filteredRegistros.filter(r => r.fecha.slice(0, 10) === hoy).map(r => r._id);
    setSelectedIds(new Set(ids));
  };
  const imprimirSeleccionados = () => {
    if (selectedIds.size === 0) return;
    window.open(`/ordenes/calibracion/stickers?ids=${[...selectedIds].join(",")}`, "_blank");
  };

  // Datos remotos
  const [patrones, setPatrones] = useState<PatronDoc[]>([]);
  const [tecnicos, setTecnicos] = useState<UserOpt[]>([]);
  const [supervisores, setSupervisores] = useState<UserOpt[]>([]);

  // Patron management
  const [allPatrones, setAllPatrones] = useState<PatronDoc[]>([]);
  const [editingPatronId, setEditingPatronId] = useState<string | null>(null);
  const [patronForm, setPatronForm] = useState<PatronForm>(emptyPatronForm());
  const [showNewPatronForm, setShowNewPatronForm] = useState(false);
  const [savingPatron, setSavingPatron] = useState(false);
  const [patronError, setPatronError] = useState("");

  // Autocomplete TAG
  const [allEquipos, setAllEquipos] = useState<EquipoResult[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<EquipoResult[]>([]);
  const [tagLoading, setTagLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // ── Load lista ──────────────────────────────────────────────────────────────
  const loadRegistros = useCallback(async () => {
    setLoadingLista(true);
    try {
      const res = await fetch("/api/calibracion?limit=80");
      const data: RegistroDoc[] = await res.json();
      setRegistros(data);
    } catch {
      // silently fail — show empty list
    } finally {
      setLoadingLista(false);
    }
  }, []);

  useEffect(() => { loadRegistros(); }, [loadRegistros]);

  // ── Load patrones, tecnicos, supervisores once ──────────────────────────────
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.user) {
          setCurrentUser(d.user);
        }
      })
      .catch(() => {});

    fetch("/api/patrones?all=1")
      .then((r) => r.json())
      .then((d: PatronDoc[]) => setPatrones(d))
      .catch(() => {});

    Promise.all([
      fetch("/api/usuarios?rol=4&area=3320").then((r) => r.json()),
      fetch("/api/usuarios?area=3320&contratista=true").then((r) => r.json()),
    ])
      .then(([tec, cont]: [UserOpt[], UserOpt[]]) => {
        // Merge técnicos + contratistas, sin duplicados por _id
        const merged = [...tec, ...cont.filter((c) => !tec.some((t) => t._id === c._id))];
        setTecnicos(merged);
      })
      .catch(() => {});

    // Supervisores: rol=3 del área 3320 + Superintendentes rol=1 que pueden firmar
    Promise.all([
      fetch("/api/usuarios?rol=3&area=3320").then((r) => r.json()),
      fetch("/api/usuarios?rol=1").then((r) => r.json()),
    ])
      .then(([sups, supers]: [UserOpt[], UserOpt[]]) => {
        const combined = [
          ...sups,
          ...supers.filter((u) => !sups.some((s) => s._id === u._id)),
        ];
        setSupervisores(combined);
      })
      .catch(() => {});

    fetch("/api/equipos?all=true&limit=2500")
      .then((r) => r.json())
      .then((d: EquipoResult[]) => setAllEquipos(d))
      .catch(() => {});
  }, []);

  // ── TAG debounced autocomplete ───────────────────────────────────────────────
  const handleTagInput = (val: string) => {
    setForm((f) => ({ ...f, tag: val }));
    setShowSuggestions(true);

    if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current);

    if (!val.trim()) {
      setTagSuggestions(allEquipos);
      return;
    }

    setTagLoading(true);
    tagDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/equipos?q=${encodeURIComponent(val)}&limit=150`);
        const data: EquipoResult[] = await res.json();
        setTagSuggestions(data);
      } catch {
        setTagSuggestions([]);
      } finally {
        setTagLoading(false);
      }
    }, 280);
  };

  const selectTag = (eq: EquipoResult) => {
    setForm((f) => ({ ...f, tag: eq.tag, descripcionInstrumento: eq.descripcion }));
    setTagSuggestions([]);
    setShowSuggestions(false);
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Patron selection — multi-select toggle ──────────────────────────────────
  const selectPatron = (p: PatronDoc) => {
    setForm((f) => {
      const already = f.patronIds.includes(p._id);
      const newIds = already ? f.patronIds.filter(id => id !== p._id) : [...f.patronIds, p._id];
      const newCodigos = already ? f.patronCodigos.filter(c => c !== p.codigo) : [...f.patronCodigos, p.codigo];
      return {
        ...f,
        patronIds: newIds,
        patronCodigos: newCodigos,
        patronId: newIds[0] ?? "",
        patronCodigo: newCodigos[0] ?? "",
      };
    });
  };

  const generatePoints = (p: PatronDoc) => {
    if (p.rangoMin === undefined || p.rangoMax === undefined) return;
    const range = p.rangoMax - p.rangoMin;
    const percents = [0, 0.25, 0.5, 0.75, 1];
    const puntos: PuntoForm[] = percents.map((pct) => ({
      lecturaPatron: String(+(p.rangoMin! + pct * range).toFixed(4)),
      lecturaInstrumento: "",
      tolerancia: "",
    }));
    setForm((f) => ({ ...f, puntos }));
  };

  // ── Patron management ───────────────────────────────────────────────────────
  const loadAllPatrones = useCallback(async () => {
    try {
      const res = await fetch("/api/patrones?all=1");
      const data: PatronDoc[] = await res.json();
      setAllPatrones(data);
    } catch {}
  }, []);

  const handleSavePatron = async () => {
    setPatronError("");
    setSavingPatron(true);
    try {
      const body = {
        ...patronForm,
        rangoMin: patronForm.rangoMin !== "" ? Number(patronForm.rangoMin) : undefined,
        rangoMax: patronForm.rangoMax !== "" ? Number(patronForm.rangoMax) : undefined,
      };
      const url = editingPatronId ? `/api/patrones/${editingPatronId}` : "/api/patrones";
      const method = editingPatronId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Error al guardar");
      await loadAllPatrones();
      const res2 = await fetch("/api/patrones");
      setPatrones(await res2.json());
      setEditingPatronId(null);
      setShowNewPatronForm(false);
      setPatronForm(emptyPatronForm());
    } catch (err: unknown) {
      setPatronError(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingPatron(false);
    }
  };

  // ── Seed patrones ───────────────────────────────────────────────────────────
  const [seeding, setSeeding] = useState(false);
  const seedPatrones = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed/patrones", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await loadAllPatrones();
      const res2 = await fetch("/api/patrones");
      setPatrones(await res2.json());
    } catch (err: unknown) {
      setPatronError(err instanceof Error ? err.message : "Error al cargar datos");
    } finally {
      setSeeding(false);
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────
  const validateStep = (s: number): boolean => {
    const errors: Partial<Record<string, string>> = {};
    if (s === 1) {
      if (!form.tag.trim()) errors.tag = "El TAG es requerido";
      if (!form.tipoVariable) errors.tipoVariable = "Seleccione tipo de variable";
    }
    if (s === 2) {
      if (form.patronIds.length === 0) errors.patronId = "Seleccione al menos un patrón de calibración";
    }
    if (s === 3) {
      if (!form.tecnicoId) errors.tecnicoId = "Seleccione un técnico";
      if (!form.unidad) errors.unidad = "Seleccione las unidades de medición";
      const filled = form.puntos.filter(
        (p) => p.lecturaPatron !== "" && p.lecturaInstrumento !== "" && p.tolerancia !== ""
      );
      if (filled.length === 0) errors.puntos = "Ingrese al menos un punto de calibración completo";
    }
    if (s === 4) {
      if (!form.tecnicoFirma) errors.tecnicoFirma = "La firma del técnico es obligatoria";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNextStep = () => {
    if (validateStep(step)) setStep((s) => s + 1);
  };

  const handlePrevStep = () => setStep((s) => s - 1);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveError("");
    setSaving(true);
    try {
      const autoResult = calcResultadoAuto(form.puntos);
      const resultadoGeneral =
        form.resultadoManual !== "" ? form.resultadoManual : autoResult ?? "RECHAZADO";

      const puntos = form.puntos
         .filter((p) => p.lecturaPatron !== "" && p.lecturaInstrumento !== "" && p.tolerancia !== "")
        .map((p) => {
          const error = Number(p.lecturaInstrumento) - Number(p.lecturaPatron);
          return {
            lecturaPatron: Number(p.lecturaPatron),
            lecturaInstrumento: Number(p.lecturaInstrumento),
            error,
            tolerancia: Number(p.tolerancia),
            aprueba: Math.abs(error) <= Number(p.tolerancia),
          };
        });

      const puntosAntes = form.puntosAntes
        .filter((p) => p.lecturaPatron !== "" && p.lecturaInstrumento !== "")
        .map((p) => {
          const error = Number(p.lecturaInstrumento) - Number(p.lecturaPatron);
          return {
            lecturaPatron: Number(p.lecturaPatron),
            lecturaInstrumento: Number(p.lecturaInstrumento),
            error,
            tolerancia: Number(p.tolerancia) || 0,
            aprueba: p.tolerancia !== "" ? Math.abs(error) <= Number(p.tolerancia) : false,
          };
        });

      const body = {
        tag: form.tag.toUpperCase(),
        descripcionInstrumento: form.descripcionInstrumento,
        tipoVariable: form.tipoVariable,
        unidad: form.unidad || undefined,
        patronIds: form.patronIds,
        patronCodigos: form.patronCodigos,
        patronId: form.patronIds[0] ?? form.patronId,
        patronCodigo: form.patronCodigos[0] ?? form.patronCodigo,
        tecnicoId: form.tecnicoId,
        tecnicoNombre: form.tecnicoNombre,
        supervisorId: form.supervisorId || undefined,
        supervisorNombre: form.supervisorNombre || undefined,
        temperatura: form.temperatura !== "" ? Number(form.temperatura) : undefined,
        humedad: form.humedad !== "" ? Number(form.humedad) : undefined,
        fecha: new Date().toISOString(),
        puntosAntes: puntosAntes.length > 0 ? puntosAntes : undefined,
        puntos,
        resultadoGeneral,
        observaciones: form.observaciones || undefined,
        otAsociada: form.otAsociada || undefined,
        stickerImpreso: form.stickerImpreso,
        estado: "revision",
        tecnicoFirma: form.tecnicoFirma,
      };

      const res = await fetch("/api/calibracion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error al guardar");

      setDetalle(data.registro as RegistroDoc);
      setRegistros((prev) => [data.registro as RegistroDoc, ...prev]);
      setView("detalle");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // ── Sticker patch ────────────────────────────────────────────────────────────
  const handleStickerToggle = async () => {
    if (!detalle) return;
    setPatchingSticker(true);
    try {
      const res = await fetch(`/api/calibracion/${detalle._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickerImpreso: true }),
      });
      const data = await res.json();
      if (data.ok) setDetalle(data.registro as RegistroDoc);
    } catch {
      // silently fail
    } finally {
      setPatchingSticker(false);
    }
  };

  // ── Filtered lista ───────────────────────────────────────────────────────────
  const filteredRegistros = registros.filter((r) => {
    const tagMatch = filterTag === "" || r.tag.toLowerCase().includes(filterTag.toLowerCase()) || r.numeroCertificado.toLowerCase().includes(filterTag.toLowerCase());
    const resMatch = filterResultado === "" || r.resultadoGeneral === filterResultado;
    return tagMatch && resMatch;
  });

  // ── Open nuevo ───────────────────────────────────────────────────────────────
  const openNuevo = () => {
    setForm(emptyForm());
    setFormErrors({});
    setSaveError("");
    setStep(1);
    setView("nuevo");
  };

  // ── Open detalle ─────────────────────────────────────────────────────────────
  const openDetalle = (r: RegistroDoc) => {
    setDetalle(r);
    setForm(f => ({
      ...f,
      supervisorId: r.supervisorId ?? "",
      supervisorNombre: r.supervisorNombre ?? "",
      supervisorFirma: r.supervisorFirma ?? "",
    }));
    setView("detalle");
  };

  const openDetalleAndScroll = (r: RegistroDoc) => {
    setShouldScrollToSupervisor(true);
    openDetalle(r);
  };

  useEffect(() => {
    if (view === "detalle" && shouldScrollToSupervisor) {
      setShouldScrollToSupervisor(false);
      setTimeout(() => {
        supervisorFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }, [view, shouldScrollToSupervisor]);

  const handleApproveBySupervisor = async () => {
    setApproveError("");
    setSupervisorErrorId("");
    setSupervisorErrorFirma("");

    let ok = true;
    if (!form.supervisorId) {
      setSupervisorErrorId("Por favor, seleccione un supervisor.");
      ok = false;
    }
    if (!form.supervisorFirma) {
      setSupervisorErrorFirma("La firma del supervisor es obligatoria.");
      ok = false;
    }
    if (!ok || !detalle) return;

    setApproving(true);
    try {
      const res = await fetch(`/api/calibracion/${detalle._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "aprobado",
          supervisorFirma: form.supervisorFirma,
          supervisorId: form.supervisorId,
          supervisorNombre: form.supervisorNombre,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error al aprobar la calibración");

      const updatedDoc = data.registro as RegistroDoc;
      setDetalle(updatedDoc);
      setRegistros((prev) =>
        prev.map((r) => (r._id === updatedDoc._id ? updatedDoc : r))
      );
    } catch (err: unknown) {
      setApproveError(err instanceof Error ? err.message : "Error al procesar la aprobación");
    } finally {
      setApproving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      <AppHeader backHref="/ordenes" />
      <main style={S.wrap}>

        {/* ── LISTA ── */}
        {view === "lista" && (
          <>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847", margin: 0 }}>
                    Registro de Calibración
                  </h1>
                  <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>
                    §2.10 — Área 3320 · ISO 17025
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    href="/ordenes/calibracion/dashboard"
                    style={{ ...S.btnOutline, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    📊 Dashboard
                  </a>
                  <button style={S.btnOutline} onClick={selectHoy}>
                    🗓 Stickers de hoy
                  </button>
                  {selectedIds.size > 0 && (
                    <>
                      <button style={S.btnOutline} onClick={() => setSelectedIds(new Set())}>
                        ✕ Limpiar ({selectedIds.size})
                      </button>
                      <button
                        style={{ ...S.btnPrimary, background: "#0891b2" }}
                        onClick={imprimirSeleccionados}
                      >
                        🖨 Imprimir stickers ({selectedIds.size})
                      </button>
                    </>
                  )}
                  <button
                    style={S.btnOutline}
                    onClick={() => {
                      setEditingPatronId(null);
                      setShowNewPatronForm(false);
                      setPatronForm(emptyPatronForm());
                      setPatronError("");
                      loadAllPatrones();
                      setView("patrones");
                    }}
                  >
                    Patrones
                  </button>
                  <button style={S.btnPrimary} onClick={openNuevo}>
                    + Nuevo Registro
                  </button>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div style={{ ...S.card, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label style={S.label}>TAG / Certificado</label>
                  <input
                    style={S.input}
                    placeholder="Buscar..."
                    value={filterTag}
                    onChange={(e) => setFilterTag(e.target.value)}
                  />
                </div>
                <div style={{ minWidth: 160 }}>
                  <label style={S.label}>Resultado</label>
                  <select
                    style={S.select}
                    value={filterResultado}
                    onChange={(e) => setFilterResultado(e.target.value)}
                  >
                    <option value="">Todos</option>
                    <option value="APROBADO">APROBADO</option>
                    <option value="RECHAZADO">RECHAZADO</option>
                    <option value="AJUSTADO">AJUSTADO</option>
                  </select>
                </div>
                <div style={{ color: "#64748b", fontSize: 12, paddingBottom: 10 }}>
                  {filteredRegistros.length} registro{filteredRegistros.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>

            {/* List */}
            {loadingLista ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontSize: 14 }}>
                Cargando registros...
              </div>
            ) : filteredRegistros.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 14 }}>
                No hay registros de calibración.
              </div>
            ) : (
              filteredRegistros.map((r) => (
                <div
                  key={r._id}
                  style={{ ...S.card, cursor: "pointer", outline: selectedIds.has(r._id) ? "2px solid #0891b2" : "none" }}
                  onClick={() => openDetalle(r)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r._id)}
                        onChange={() => toggleSelect(r._id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginTop: 3, width: 16, height: 16, accentColor: "#0891b2", cursor: "pointer", flexShrink: 0 }}
                      />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>
                          {r.numeroCertificado}
                        </span>
                        {r.estado === "revision" ? (
                          <span style={S.badge("#d97706")}>
                            ⚠ EN REVISIÓN
                          </span>
                        ) : (
                          <span style={S.badge(RESULTADO_COLOR[r.resultadoGeneral] ?? "#64748b")}>
                            {r.resultadoGeneral}
                          </span>
                        )}
                        {r.stickerImpreso && (
                          <span style={S.badge("#0891b2")}>✓ Sticker</span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: "#1e293b", fontWeight: 600 }}>{r.tag}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {r.descripcionInstrumento}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                        {r.tipoVariable} · {r.tecnicoNombre}
                      </div>
                      {r.estado === "revision" && (
                        <div style={{ marginTop: 10 }}>
                          <button
                            style={{
                              background: "#fef3c7",
                              color: "#d97706",
                              border: "1px solid #fde68a",
                              borderRadius: 6,
                              padding: "5px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetalleAndScroll(r);
                            }}
                          >
                            ✍️ Firmar Aprobación
                          </button>
                        </div>
                      )}
                    </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{fmtDate(r.fecha)}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{r.turno}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ── NUEVO ── */}
        {view === "nuevo" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <button style={S.btnGhost} onClick={() => setView("lista")}>← Volver</button>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f2847", margin: 0 }}>
                Nuevo Registro de Calibración
              </h2>
            </div>

            <StepIndicator step={step} />

            {/* Step 1 — Instrumento */}
            {step === 1 && (
              <div style={S.card}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                  Paso 1 — Instrumento
                </h3>

                {/* TAG autocomplete */}
                <div style={{ marginBottom: 14, position: "relative" }} ref={suggestionsRef}>
                  <label style={S.label}>TAG del instrumento *</label>
                  <input
                    style={{ ...S.input, borderColor: formErrors.tag ? "#dc2626" : "#cbd5e1" }}
                    placeholder="Ej: PT-3320-01"
                    value={form.tag}
                    onChange={(e) => handleTagInput(e.target.value)}
                    onFocus={() => {
                      setTagSuggestions(!form.tag.trim() ? allEquipos : allEquipos.filter(eq =>
                        eq.tag.toLowerCase().includes(form.tag.toLowerCase()) ||
                        eq.descripcion.toLowerCase().includes(form.tag.toLowerCase())
                      ));
                      setShowSuggestions(true);
                    }}
                    autoComplete="off"
                  />
                  {formErrors.tag && <p style={S.err}>{formErrors.tag}</p>}
                  {showSuggestions && (tagSuggestions.length > 0 || tagLoading) && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                      background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.1)", maxHeight: 200, overflowY: "auto",
                    }}>
                      {tagLoading && (
                        <div style={{ padding: "10px 14px", color: "#94a3b8", fontSize: 13 }}>
                          Buscando...
                        </div>
                      )}
                      {tagSuggestions.map((eq) => (
                        <div
                          key={eq.tag}
                          style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                          onMouseDown={() => selectTag(eq)}
                        >
                          <div style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>{eq.tag}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{eq.descripcion}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Descripción */}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Descripción del instrumento</label>
                  <input
                    style={S.input}
                    placeholder="Descripción del instrumento"
                    value={form.descripcionInstrumento}
                    onChange={(e) => setForm((f) => ({ ...f, descripcionInstrumento: e.target.value }))}
                  />
                </div>

                {/* Tipo variable */}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Tipo de variable *</label>
                  <select
                    style={{ ...S.select, borderColor: formErrors.tipoVariable ? "#dc2626" : "#cbd5e1" }}
                    value={form.tipoVariable}
                    onChange={(e) => setForm((f) => ({ ...f, tipoVariable: e.target.value }))}
                  >
                    <option value="">Seleccionar...</option>
                    {TIPOS_VARIABLE.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {formErrors.tipoVariable && <p style={S.err}>{formErrors.tipoVariable}</p>}
                </div>

                {/* Condiciones ambientales */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={S.label}>Temperatura (°C)</label>
                    <input
                      type="number"
                      step="0.1"
                      style={S.input}
                      placeholder="Ej: 22.5"
                      value={form.temperatura}
                      onChange={(e) => setForm((f) => ({ ...f, temperatura: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={S.label}>Humedad relativa (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      style={S.input}
                      placeholder="Ej: 45.0"
                      value={form.humedad}
                      onChange={(e) => setForm((f) => ({ ...f, humedad: e.target.value }))}
                    />
                  </div>
                </div>

                {/* OT Asociada */}
                <div style={{ marginBottom: 4 }}>
                  <label style={S.label}>OT asociada (opcional)</label>
                  <input
                    style={S.input}
                    placeholder="Número de OT"
                    value={form.otAsociada}
                    onChange={(e) => setForm((f) => ({ ...f, otAsociada: e.target.value }))}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                  <button style={S.btnPrimary} onClick={handleNextStep}>
                    Siguiente →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 — Patrones (multi-select) */}
            {step === 2 && (
              <div style={S.card}>
                <h3 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                  Paso 2 — Patrones de calibración
                </h3>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
                  Variable: <strong>{form.tipoVariable}</strong> · Podés seleccionar <strong>uno o más patrones</strong>
                  {form.patronIds.length > 0 && (
                    <span style={{ marginLeft: 8, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
                      {form.patronIds.length} seleccionado{form.patronIds.length > 1 ? "s" : ""}
                    </span>
                  )}
                </p>

                {formErrors.patronId && (
                  <p style={{ ...S.err, marginBottom: 12 }}>{formErrors.patronId}</p>
                )}

                {patrones.length === 0 && (
                  <div style={{ color: "#94a3b8", fontSize: 13, padding: "16px 0" }}>Cargando patrones...</div>
                )}

                {(() => {
                  const vigentes = patrones.filter((p) => !isVencido(p.fechaVencimiento));
                  const display = (!form.tipoVariable || form.tipoVariable === "Otro")
                    ? vigentes
                    : (() => {
                        const f = vigentes.filter((p) => p.tipo === form.tipoVariable || p.tipo === "Multifunción");
                        return f.length > 0 ? f : vigentes;
                      })();
                  return display.map((p, idx) => {
                    const vencido = isVencido(p.fechaVencimiento);
                    const proximo = !vencido && isProximoAVencer(p.fechaVencimiento);
                    const selected = form.patronIds.includes(p._id);
                    const selIdx = form.patronIds.indexOf(p._id); // posición (1°, 2°, 3°)
                    return (
                      <div
                        key={p._id}
                        onClick={() => selectPatron(p)}
                        style={{
                          border: `2px solid ${selected ? "#2563eb" : "#e2e8f0"}`,
                          borderRadius: 10,
                          padding: "12px 14px",
                          marginBottom: 8,
                          cursor: "pointer",
                          background: selected ? "#eff6ff" : idx % 2 === 0 ? "white" : "#fafafa",
                          transition: "border-color 0.15s, background 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                              {selected && (
                                <span style={{ background: "#2563eb", color: "white", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 7px", minWidth: 22, textAlign: "center" }}>
                                  {selIdx + 1}°
                                </span>
                              )}
                              <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>{p.codigo}</span>
                              <span style={{ fontSize: 11, color: "#64748b" }}>{p.tipo}</span>
                              {!p.activo && <span style={S.badge("#64748b")}>Inactivo</span>}
                              {vencido && <span style={S.badge("#dc2626")}>⚠ VENCIDO</span>}
                              {proximo && <span style={S.badge("#d97706")}>Próx. vencer</span>}
                            </div>
                            <div style={{ fontSize: 12, color: "#1e293b" }}>{p.descripcion}</div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                              {p.marca} {p.modelo}
                              {p.rangoMin !== undefined && p.rangoMax !== undefined && <> · {p.rangoMin}–{p.rangoMax}</>}
                              {p.precision && <> · ±{p.precision}</>}
                            </div>
                            <div style={{ fontSize: 10, color: vencido ? "#dc2626" : "#94a3b8", marginTop: 2 }}>
                              Vencimiento: {fmtDate(p.fechaVencimiento)}
                            </div>
                          </div>
                          {/* Checkbox visual */}
                          <div style={{
                            width: 22, height: 22, borderRadius: 5, flexShrink: 0, marginTop: 2,
                            border: `2px solid ${selected ? "#2563eb" : "#cbd5e1"}`,
                            background: selected ? "#2563eb" : "white",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {selected && (
                              <svg width={12} height={12} viewBox="0 0 12 12">
                                <polyline points="2,6 5,9 10,3" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {selected && p.rangoMin !== undefined && p.rangoMax !== undefined && (
                          <div style={{ marginTop: 10, borderTop: "1px solid #dbeafe", paddingTop: 8 }}>
                            <button
                              style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px" }}
                              onClick={(e) => { e.stopPropagation(); generatePoints(p); }}
                            >
                              Generar 5 puntos automáticos (Patrón {selIdx + 1})
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
                  <button style={S.btnGhost} onClick={handlePrevStep}>← Anterior</button>
                  <button style={S.btnPrimary} onClick={handleNextStep}>Siguiente →</button>
                </div>
              </div>
            )}

            {/* Step 3 — Puntos */}
            {step === 3 && (
              <div style={S.card}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                  Paso 3 — Mediciones de calibración
                </h3>

                {/* Técnico */}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Técnico *</label>
                  <select
                    style={{ ...S.select, borderColor: formErrors.tecnicoId ? "#dc2626" : "#cbd5e1" }}
                    value={form.tecnicoId}
                    onChange={(e) => {
                      const opt = tecnicos.find((u) => u._id === e.target.value);
                      setForm((f) => ({ ...f, tecnicoId: e.target.value, tecnicoNombre: opt?.nombreCompleto ?? "" }));
                    }}
                  >
                    <option value="">Seleccionar técnico...</option>
                    {tecnicos.map((u) => (
                      <option key={u._id} value={u._id}>{u.nombreCompleto}</option>
                    ))}
                  </select>
                  {formErrors.tecnicoId && <p style={S.err}>{formErrors.tecnicoId}</p>}
                </div>

                {/* Supervisor — solo Instrumentación y Eléctrico */}
                <div style={{ marginBottom: 16 }}>
                  <label style={S.label}>Supervisor (opcional) <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>Instrumentación / Eléctrico</span></label>
                  <select
                    style={S.select}
                    value={form.supervisorId}
                    onChange={(e) => {
                      const opt = supervisores.find((u) => u._id === e.target.value);
                      setForm((f) => ({ ...f, supervisorId: e.target.value, supervisorNombre: opt?.nombreCompleto ?? "" }));
                    }}
                  >
                    <option value="">Sin supervisor</option>
                    {supervisores.map((u) => (
                      <option key={u._id} value={u._id}>{u.nombreCompleto}</option>
                    ))}
                  </select>
                </div>

                {/* Unidades */}
                <div style={{ marginBottom: 18 }}>
                  <label style={S.label}>Unidades de medición *</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(UNIDADES_VARIABLE[form.tipoVariable] ?? ["—"]).map((u) => (
                      <button
                        key={u}
                        style={{
                          border: `1px solid ${form.unidad === u ? "#2563eb" : "#e2e8f0"}`,
                          background: form.unidad === u ? "#eff6ff" : "white",
                          color: form.unidad === u ? "#2563eb" : "#64748b",
                          borderRadius: 7, padding: "7px 14px", fontSize: 13,
                          fontWeight: form.unidad === u ? 700 : 500, cursor: "pointer",
                        }}
                        onClick={() => setForm((f) => ({ ...f, unidad: u }))}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  {formErrors.unidad && <p style={S.err}>{formErrors.unidad}</p>}
                </div>

                {/* ── SECCIÓN: Antes de calibrar (opcional) ── */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0f2847" }}>
                      Mediciones antes de calibrar
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>opcional</span>
                    </h4>
                    <button
                      style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px" }}
                      onClick={() => setForm((f) => ({
                        ...f,
                        puntosAntes: [...f.puntosAntes, { lecturaPatron: "", lecturaInstrumento: "", tolerancia: "" }],
                      }))}
                    >
                      + Punto
                    </button>
                  </div>
                  {form.puntosAntes.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>
                      Sin mediciones antes. Pulse "+ Punto" para agregar.
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "#fef3c7" }}>
                            {["#", `Patrón${form.unidad ? ` (${form.unidad})` : ""}`, `Lectura${form.unidad ? ` (${form.unidad})` : ""}`, "Error", "Error %", `Tol.${form.unidad ? ` (${form.unidad})` : ""}`, "Estado", ""].map((h) => (
                              <th key={h} style={{ padding: "7px 6px", borderBottom: "1px solid #fde68a", color: "#92400e", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {form.puntosAntes.map((p, i) => {
                            const err = calcErrorAntes(p);
                            const aprueba = calcApruebaAntes(p);
                            const errPct = (err !== null && Number(p.lecturaPatron) !== 0)
                              ? (err / Number(p.lecturaPatron)) * 100 : null;
                            return (
                              <tr key={i} style={{ borderBottom: "1px solid #fef3c7", background: aprueba === false ? "#fef2f2" : aprueba === true ? "#f0fdf4" : "white" }}>
                                <td style={{ padding: "5px 6px", color: "#94a3b8", fontWeight: 600 }}>{i + 1}</td>
                                {(["lecturaPatron", "lecturaInstrumento"] as const).map((field) => (
                                  <td key={field} style={{ padding: "3px 4px" }}>
                                    <input
                                      type="number" step="any"
                                      style={{ ...S.input, padding: "5px 7px", fontSize: 12, width: 80 }}
                                      value={p[field]}
                                      onChange={(e) => {
                                        const updated = form.puntosAntes.map((pt, idx) =>
                                          idx === i ? { ...pt, [field]: e.target.value } : pt
                                        );
                                        setForm((f) => ({ ...f, puntosAntes: updated }));
                                      }}
                                    />
                                  </td>
                                ))}
                                <td style={{ padding: "5px 6px", color: aprueba === false ? "#dc2626" : "#1e293b", fontWeight: 600, whiteSpace: "nowrap" }}>
                                  {err !== null ? (err >= 0 ? "+" : "") + err.toFixed(3) : "—"}
                                </td>
                                <td style={{ padding: "5px 6px", color: "#64748b", whiteSpace: "nowrap" }}>
                                  {errPct !== null ? (errPct >= 0 ? "+" : "") + errPct.toFixed(2) + "%" : "—"}
                                </td>
                                <td style={{ padding: "3px 4px" }}>
                                  <input
                                    type="number" step="any"
                                    style={{ ...S.input, padding: "5px 7px", fontSize: 12, width: 80 }}
                                    value={p.tolerancia}
                                    onChange={(e) => {
                                      const updated = form.puntosAntes.map((pt, idx) =>
                                        idx === i ? { ...pt, tolerancia: e.target.value } : pt
                                      );
                                      setForm((f) => ({ ...f, puntosAntes: updated }));
                                    }}
                                  />
                                </td>
                                <td style={{ padding: "5px 6px", textAlign: "center", fontSize: 15 }}>
                                  {aprueba === true ? <span style={{ color: "#16a34a" }}>✓</span> : aprueba === false ? <span style={{ color: "#dc2626" }}>✗</span> : "—"}
                                </td>
                                <td style={{ padding: "5px 6px" }}>
                                  <button
                                    style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13, padding: "2px 5px" }}
                                    onClick={() => setForm((f) => ({ ...f, puntosAntes: f.puntosAntes.filter((_, idx) => idx !== i) }))}
                                  >✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── SECCIÓN: Después de calibrar (requerido) ── */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0f2847" }}>
                      Mediciones después de calibrar
                    </h4>
                  </div>

                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          {["#", `Patrón${form.unidad ? ` (${form.unidad})` : ""}`, `Lectura${form.unidad ? ` (${form.unidad})` : ""}`, "Error", "Error %", `Tol.${form.unidad ? ` (${form.unidad})` : ""}`, "Estado", ""].map((h) => (
                            <th key={h} style={{ padding: "7px 6px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {form.puntos.map((p, i) => {
                          const err = calcError(p);
                          const aprueba = calcAprueba(p);
                          const errPct = (err !== null && Number(p.lecturaPatron) !== 0)
                            ? (err / Number(p.lecturaPatron)) * 100 : null;
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: aprueba === false ? "#fef2f2" : aprueba === true ? "#f0fdf4" : "white" }}>
                              <td style={{ padding: "5px 6px", color: "#94a3b8", fontWeight: 600 }}>{i + 1}</td>
                              {(["lecturaPatron", "lecturaInstrumento"] as const).map((field) => (
                                <td key={field} style={{ padding: "3px 4px" }}>
                                  <input
                                    type="number" step="any"
                                    style={{ ...S.input, padding: "5px 7px", fontSize: 12, width: 80 }}
                                    value={p[field]}
                                    onChange={(e) => {
                                      const updated = form.puntos.map((pt, idx) =>
                                        idx === i ? { ...pt, [field]: e.target.value } : pt
                                      );
                                      setForm((f) => ({ ...f, puntos: updated }));
                                    }}
                                  />
                                </td>
                              ))}
                              <td style={{ padding: "5px 6px", color: aprueba === false ? "#dc2626" : "#1e293b", fontWeight: 600, whiteSpace: "nowrap" }}>
                                {err !== null ? (err >= 0 ? "+" : "") + err.toFixed(3) : "—"}
                              </td>
                              <td style={{ padding: "5px 6px", color: "#64748b", whiteSpace: "nowrap" }}>
                                {errPct !== null ? (errPct >= 0 ? "+" : "") + errPct.toFixed(2) + "%" : "—"}
                              </td>
                              <td style={{ padding: "3px 4px" }}>
                                <input
                                  type="number" step="any"
                                  style={{ ...S.input, padding: "5px 7px", fontSize: 12, width: 80 }}
                                  value={p.tolerancia}
                                  onChange={(e) => {
                                    const updated = form.puntos.map((pt, idx) =>
                                      idx === i ? { ...pt, tolerancia: e.target.value } : pt
                                    );
                                    setForm((f) => ({ ...f, puntos: updated }));
                                  }}
                                />
                              </td>
                              <td style={{ padding: "5px 6px", textAlign: "center", fontSize: 15 }}>
                                {aprueba === true ? <span style={{ color: "#16a34a" }}>✓</span> : aprueba === false ? <span style={{ color: "#dc2626" }}>✗</span> : "—"}
                              </td>
                              <td style={{ padding: "5px 6px" }}>
                                {form.puntos.length > 1 && (
                                  <button
                                    style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13, padding: "2px 5px" }}
                                    onClick={() => setForm((f) => ({ ...f, puntos: f.puntos.filter((_, idx) => idx !== i) }))}
                                  >✕</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <button
                    style={{ ...S.btnGhost, marginTop: 10, fontSize: 12 }}
                    onClick={() => setForm((f) => ({ ...f, puntos: [...f.puntos, { lecturaPatron: "", lecturaInstrumento: "", tolerancia: "" }] }))}
                  >
                    + Agregar punto
                  </button>

                  {formErrors.puntos && <p style={{ ...S.err, marginTop: 8 }}>{formErrors.puntos}</p>}

                  {(() => {
                    const r = calcResultadoAuto(form.puntos);
                    if (!r) return null;
                    return (
                      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Resultado calculado:</span>
                        <span style={S.badge(RESULTADO_COLOR[r])}>{r}</span>
                      </div>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
                  <button style={S.btnGhost} onClick={handlePrevStep}>← Anterior</button>
                  <button style={S.btnPrimary} onClick={handleNextStep}>Siguiente →</button>
                </div>
              </div>
            )}

            {/* Step 4 — Firma Técnico */}
            {step === 4 && (
              <div style={S.card}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                  Paso 4 — Firma del Técnico
                </h3>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>
                  Por favor, dibuje su firma digital o suba un archivo de imagen (PNG/JPG) para validar la calibración antes del envío.
                </p>

                <SignatureSelector
                  value={form.tecnicoFirma}
                  onChange={(val) => setForm(f => ({ ...f, tecnicoFirma: val }))}
                  label="Firma del Técnico *"
                />

                {formErrors.tecnicoFirma && <p style={{ ...S.err, marginTop: 10 }}>{formErrors.tecnicoFirma}</p>}

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 20 }}>
                  <button style={S.btnGhost} onClick={handlePrevStep}>← Anterior</button>
                  <button style={S.btnPrimary} onClick={handleNextStep}>Siguiente →</button>
                </div>
              </div>
            )}

            {/* Step 5 — Revisión */}
            {step === 5 && (
              <div style={S.card}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                  Paso 5 — Revisión final
                </h3>

                {/* Summary grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 16 }}>
                  {[
                    ["TAG", form.tag],
                    ["Instrumento", form.descripcionInstrumento || "—"],
                    ["Tipo de variable", form.tipoVariable],
                    ["Unidades", form.unidad || "—"],
                    ["Patrón", form.patronCodigo],
                    ["Técnico", form.tecnicoNombre || "—"],
                    ["Supervisor", form.supervisorNombre || "—"],
                    ["Fecha", fmtDate(form.fecha)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</div>
                      <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, marginTop: 2 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Points read-only */}
                <div style={{ overflowX: "auto", marginBottom: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["#", `Patrón${form.unidad ? " (" + form.unidad + ")" : ""}`, `Lectura${form.unidad ? " (" + form.unidad + ")" : ""}`, "Error", "Error %", `Tol.`, "Estado"].map((h) => (
                          <th key={h} style={{ padding: "7px 8px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontWeight: 700, textAlign: "left" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {form.puntos.filter((p) => p.lecturaPatron !== "").map((p, i) => {
                        const err = calcError(p);
                        const aprueba = calcAprueba(p);
                        return (
                          <tr key={i} style={{ background: aprueba === false ? "#fef2f2" : aprueba === true ? "#f0fdf4" : "white", borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{i + 1}</td>
                            <td style={{ padding: "6px 8px" }}>{p.lecturaPatron || "—"}</td>
                            <td style={{ padding: "6px 8px" }}>{p.lecturaInstrumento || "—"}</td>
                            <td style={{ padding: "6px 8px", color: aprueba === false ? "#dc2626" : "#1e293b" }}>
                              {err !== null ? (err >= 0 ? "+" : "") + err.toFixed(3) : "—"}
                            </td>
                            <td style={{ padding: "6px 8px", color: "#64748b" }}>
                              {(() => {
                                if (err === null || Number(p.lecturaPatron) === 0) return "—";
                                const pct = (err / Number(p.lecturaPatron)) * 100;
                                return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
                              })()}
                            </td>
                            <td style={{ padding: "6px 8px" }}>{p.tolerancia || "—"}</td>
                            <td style={{ padding: "6px 8px", fontSize: 16 }}>
                              {aprueba === true ? <span style={{ color: "#16a34a" }}>✓</span> : aprueba === false ? <span style={{ color: "#dc2626" }}>✗</span> : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Resultado */}
                {(() => {
                  const autoResult = calcResultadoAuto(form.puntos);
                  const displayed = form.resultadoManual !== "" ? form.resultadoManual : autoResult ?? "RECHAZADO";
                  const color = RESULTADO_COLOR[displayed] ?? "#64748b";
                  return (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Resultado:</span>
                        <span style={{ ...S.badge(color), fontSize: 13 }}>{displayed}</span>
                      </div>
                      {(autoResult === "RECHAZADO" || form.resultadoManual === "RECHAZADO") && (
                        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "10px 14px" }}>
                          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#92400e" }}>
                            El instrumento fue rechazado. ¿Desea registrar como AJUSTADO?
                          </p>
                          <button
                            style={{ ...S.btnGhost, fontSize: 12, color: "#d97706", borderColor: "#d97706" }}
                            onClick={() => setForm((f) => ({
                              ...f,
                              resultadoManual: f.resultadoManual === "AJUSTADO" ? "" : "AJUSTADO",
                            }))}
                          >
                            {form.resultadoManual === "AJUSTADO"
                              ? "✓ Marcado como AJUSTADO — click para revertir"
                              : "Marcar como AJUSTADO"}
                          </button>
                          {form.resultadoManual === "AJUSTADO" && (
                            <p style={{ margin: "8px 0 0", fontSize: 11, color: "#92400e" }}>
                              El instrumento fue ajustado durante la calibración.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Observaciones */}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Observaciones (opcional)</label>
                  <textarea
                    style={S.textarea}
                    placeholder="Observaciones adicionales..."
                    value={form.observaciones}
                    onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))}
                  />
                </div>

                {/* Sticker */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.stickerImpreso}
                      onChange={(e) => setForm((f) => ({ ...f, stickerImpreso: e.target.checked }))}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 13, color: "#1e293b" }}>Sticker impreso</span>
                  </label>
                </div>

                {saveError && <p style={{ ...S.err, marginBottom: 12 }}>{saveError}</p>}

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <button style={S.btnGhost} onClick={handlePrevStep}>← Editar</button>
                  <button
                    style={{ ...S.btnGreen, opacity: saving ? 0.7 : 1 }}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Guardando..." : "💾 Guardar"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── DETALLE ── */}
        {view === "detalle" && detalle && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <button
                style={S.btnGhost}
                onClick={() => { setView("lista"); setDetalle(null); }}
              >
                ← Lista
              </button>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: "#0f2847" }}>
                    {detalle.numeroCertificado}
                  </span>
                  <span style={{ ...S.badge(RESULTADO_COLOR[detalle.resultadoGeneral] ?? "#64748b"), fontSize: 13 }}>
                    {detalle.resultadoGeneral}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  {fmtDate(detalle.fecha)} · {detalle.turno}
                </div>
              </div>
              {/* PDF / Sticker actions */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={`/ordenes/calibracion/${detalle._id}/certificado`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    ...S.btnPrimary,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                  }}
                >
                  📄 Certificado PDF
                </a>
                <a
                  href={`/ordenes/calibracion/${detalle._id}/sticker`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    ...S.btnOutline,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                  }}
                >
                  🏷 Sticker
                </a>
              </div>
            </div>

            {/* Info grid */}
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
                {[
                  ["TAG", detalle.tag],
                  ["Instrumento", detalle.descripcionInstrumento],
                  ["Tipo de variable", detalle.tipoVariable],
                  ["Patrón", detalle.patronCodigo],
                  ["Técnico", detalle.tecnicoNombre],
                  ["Supervisor", detalle.supervisorId || "—"],
                  ["Turno", detalle.turno],
                  ["OT asociada", detalle.otAsociada || "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</div>
                    <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Points table */}
            <div style={{ ...S.card, marginBottom: 12, overflowX: "auto" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#0f2847" }}>
                Puntos de calibración
              </h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["#", "Patrón", "Lectura", "Error", "Tolerancia", "Estado"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontWeight: 700, textAlign: "left" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detalle.puntos.map((p, i) => (
                    <tr
                      key={i}
                      style={{
                        background: p.aprueba ? "#f0fdf4" : "#fef2f2",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{i + 1}</td>
                      <td style={{ padding: "8px 10px" }}>{p.lecturaPatron}</td>
                      <td style={{ padding: "8px 10px" }}>{p.lecturaInstrumento}</td>
                      <td style={{ padding: "8px 10px", color: p.aprueba ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                        ±{Math.abs(p.error).toFixed(3)}
                      </td>
                      <td style={{ padding: "8px 10px" }}>{p.tolerancia}</td>
                      <td style={{ padding: "8px 10px", fontSize: 16 }}>
                        {p.aprueba
                          ? <span style={{ color: "#16a34a" }}>✓</span>
                          : <span style={{ color: "#dc2626" }}>✗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Firmas de Validación */}
            <div style={{ ...S.card, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#0f2847" }}>
                Firmas de Validación
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Técnico signature */}
                <div style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: 12, background: "#f8fafc", textAlign: "center" }}>
                  <div style={S.label}>Técnico Calibrador</div>
                  <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, marginBottom: 8 }}>{detalle.tecnicoNombre}</div>
                  {detalle.tecnicoFirma ? (
                    <img src={detalle.tecnicoFirma} alt="Firma Técnico" style={{ maxHeight: 70, maxWidth: "100%", objectFit: "contain", background: "white", border: "1px solid #e2e8f0", padding: 4, borderRadius: 4 }} />
                  ) : (
                    <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0" }}>Sin firma digital</div>
                  )}
                </div>

                {/* Supervisor signature */}
                <div style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: 12, background: "#f8fafc", textAlign: "center" }}>
                  <div style={S.label}>Supervisor Aprobador</div>
                  <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, marginBottom: 8 }}>{detalle.supervisorNombre || "—"}</div>
                  {detalle.supervisorFirma ? (
                    <img src={detalle.supervisorFirma} alt="Firma Supervisor" style={{ maxHeight: 70, maxWidth: "100%", objectFit: "contain", background: "white", border: "1px solid #e2e8f0", padding: 4, borderRadius: 4 }} />
                  ) : (
                    <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0" }}>Pendiente de aprobación</div>
                  )}
                </div>
              </div>
            </div>

            {/* Revisión y Aprobación del Supervisor */}
            {detalle.estado === "revision" && (currentUser?.rol === 3 || currentUser?.rol === 1 || currentUser?.rol === 2) && (
              <div ref={supervisorFormRef} style={{ ...S.card, border: "2px solid #f59e0b", background: "#fffbeb", marginBottom: 12 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 800, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>
                  ✍️ Revisión y Aprobación del Supervisor
                </h4>
                <p style={{ margin: "0 0 14px", fontSize: 12, color: "#78350f" }}>
                  Como supervisor, seleccione su nombre, dibuje o suba su firma digital y apruebe esta calibración para cambiar el estado a <strong>APROBADO</strong>.
                </p>

                {/* Supervisor dropdown selection */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ ...S.label, color: "#78350f" }}>Seleccionar Supervisor *</label>
                  <select
                    style={S.select}
                    value={form.supervisorId}
                    onChange={(e) => {
                      const opt = supervisores.find((u) => u._id === e.target.value);
                      setForm((f) => ({ ...f, supervisorId: e.target.value, supervisorNombre: opt?.nombreCompleto ?? "" }));
                    }}
                  >
                    <option value="">Seleccione un supervisor...</option>
                    {supervisores.map((u) => (
                      <option key={u._id} value={u._id}>{u.nombreCompleto}</option>
                    ))}
                  </select>
                  {supervisorErrorId && <p style={S.err}>{supervisorErrorId}</p>}
                </div>

                {/* Signature canvas for Supervisor */}
                <div style={{ marginBottom: 14 }}>
                  <SignatureSelector
                    value={form.supervisorFirma}
                    onChange={(val) => setForm(f => ({ ...f, supervisorFirma: val }))}
                    label="Firma del Supervisor *"
                  />
                  {supervisorErrorFirma && <p style={S.err}>{supervisorErrorFirma}</p>}
                </div>

                {approveError && (
                  <p style={{ ...S.err, marginBottom: 12 }}>{approveError}</p>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    style={{ ...S.btnGreen, background: "#d97706", display: "inline-flex", alignItems: "center", gap: 6, opacity: approving ? 0.7 : 1 }}
                    disabled={approving}
                    onClick={handleApproveBySupervisor}
                  >
                    {approving ? "Procesando..." : "✍️ Firmar y Aprobar Calibración"}
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={S.card}>
              {detalle.observaciones && (
                <div style={{ marginBottom: 14 }}>
                  <div style={S.label}>Observaciones</div>
                  <p style={{ fontSize: 13, color: "#1e293b", margin: 0 }}>{detalle.observaciones}</p>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: "#64748b" }}>Sticker:</div>
                {detalle.stickerImpreso ? (
                  <span style={S.badge("#16a34a")}>✓ Sticker impreso</span>
                ) : (
                  <button
                    style={{ ...S.btnOutline, fontSize: 12 }}
                    onClick={handleStickerToggle}
                    disabled={patchingSticker}
                  >
                    {patchingSticker ? "Procesando..." : "Imprimir sticker"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── PATRONES ── */}
        {view === "patrones" && (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button style={S.btnGhost} onClick={() => setView("lista")}>← Volver</button>
                <div>
                  <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0f2847", margin: 0 }}>
                    Patrones de Calibración
                  </h1>
                  <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>
                    Gestión de patrones · ISO 17025
                  </p>
                </div>
              </div>
              <button
                style={S.btnPrimary}
                onClick={() => {
                  setShowNewPatronForm(true);
                  setEditingPatronId(null);
                  setPatronForm(emptyPatronForm());
                  setPatronError("");
                }}
              >
                + Agregar Patrón
              </button>
            </div>

            {/* Status summary */}
            {allPatrones.length > 0 && (() => {
              const vencidos = allPatrones.filter((p) => isVencido(p.fechaVencimiento)).length;
              const proximos = allPatrones.filter((p) => !isVencido(p.fechaVencimiento) && isProximoAVencer(p.fechaVencimiento)).length;
              const vigentes = allPatrones.filter((p) => !isVencido(p.fechaVencimiento) && !isProximoAVencer(p.fechaVencimiento)).length;
              return (
                <div style={{ ...S.card, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Estado general:</span>
                  {vencidos > 0 && <span style={S.badge("#dc2626")}>⚠ {vencidos} vencido{vencidos > 1 ? "s" : ""}</span>}
                  {proximos > 0 && <span style={S.badge("#d97706")}>⏰ {proximos} próximo{proximos > 1 ? "s" : ""} a vencer</span>}
                  <span style={S.badge("#16a34a")}>{vigentes} vigente{vigentes !== 1 ? "s" : ""}</span>
                  <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>
                    {allPatrones.length} patrón{allPatrones.length !== 1 ? "es" : ""} total
                  </span>
                </div>
              );
            })()}

            {/* New patron form */}
            {showNewPatronForm && (
              <div style={{ ...S.card, border: "1px solid #dbeafe", marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginBottom: 12 }}>Nuevo Patrón</div>
                <PatronFormInline
                  form={patronForm}
                  setForm={setPatronForm}
                  onSave={handleSavePatron}
                  onCancel={() => { setShowNewPatronForm(false); setPatronForm(emptyPatronForm()); setPatronError(""); }}
                  saving={savingPatron}
                  error={patronError}
                  isEdit={false}
                />
              </div>
            )}

            {patronError && (
              <div style={{ ...S.card, borderColor: "#fecaca", background: "#fef2f2", marginBottom: 12 }}>
                <p style={{ color: "#dc2626", fontSize: 13, margin: 0 }}>{patronError}</p>
              </div>
            )}

            {/* Patron list */}
            {allPatrones.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
                <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 16 }}>
                  No hay patrones registrados.
                </p>
                <button
                  style={{ ...S.btnOutline, opacity: seeding ? 0.7 : 1 }}
                  onClick={seedPatrones}
                  disabled={seeding}
                >
                  {seeding ? "Cargando..." : "Cargar datos de Patrón.md"}
                </button>
                <p style={{ color: "#94a3b8", fontSize: 11, marginTop: 10 }}>
                  Importa los 21 patrones del laboratorio desde el archivo fuente.
                </p>
              </div>
            ) : (
              allPatrones.map((p) => {
                const vencido = isVencido(p.fechaVencimiento);
                const proximo = !vencido && isProximoAVencer(p.fechaVencimiento);
                const isEditing = editingPatronId === p._id;
                return (
                  <div
                    key={p._id}
                    style={{
                      ...S.card,
                      borderColor: vencido ? "#fecaca" : proximo ? "#fde68a" : "#e2e8f0",
                      marginBottom: 10,
                    }}
                  >
                    {!isEditing ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                            <span style={{ fontWeight: 800, fontSize: 14, color: "#0f2847" }}>{p.codigo}</span>
                            <span style={{ fontSize: 12, color: "#64748b" }}>{p.tipo}</span>
                            {!p.activo && <span style={S.badge("#94a3b8")}>Inactivo</span>}
                            {vencido && <span style={S.badge("#dc2626")}>⚠ VENCIDO</span>}
                            {proximo && <span style={S.badge("#d97706")}>⏰ Próximo a vencer</span>}
                          </div>
                          <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 4 }}>{p.descripcion}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            {p.marca} {p.modelo}
                            {p.numeroSerie && <> · S/N: {p.numeroSerie}</>}
                            {p.rangoMin !== undefined && p.rangoMax !== undefined && (
                              <> · Rango: {p.rangoMin} – {p.rangoMax}</>
                            )}
                            {p.precision && <> · Precisión: {p.precision}</>}
                          </div>
                          <div style={{ fontSize: 11, marginTop: 4 }}>
                            <span style={{ color: "#94a3b8" }}>
                              Últ. cal: {fmtDate(p.fechaUltimaCalibracion)} · {p.frecuenciaCalibracion}
                            </span>
                            {" · "}
                            <span style={{ color: vencido ? "#dc2626" : proximo ? "#d97706" : "#94a3b8", fontWeight: (vencido || proximo) ? 700 : 400 }}>
                              Vence: {fmtDate(p.fechaVencimiento)}
                            </span>
                          </div>
                          {p.ubicacion && (
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                              Ubicación: {p.ubicacion}
                            </div>
                          )}
                        </div>
                        <button
                          style={{ ...S.btnGhost, fontSize: 12, flexShrink: 0 }}
                          onClick={() => {
                            setEditingPatronId(p._id);
                            setShowNewPatronForm(false);
                            setPatronError("");
                            setPatronForm({
                              codigo: p.codigo,
                              descripcion: p.descripcion,
                              tipo: p.tipo,
                              marca: p.marca,
                              modelo: p.modelo,
                              numeroSerie: p.numeroSerie ?? "",
                              fechaUltimaCalibracion: p.fechaUltimaCalibracion?.slice(0, 10) ?? "",
                              fechaVencimiento: p.fechaVencimiento?.slice(0, 10) ?? "",
                              frecuenciaCalibracion: p.frecuenciaCalibracion ?? "1 año",
                              rangoMin: p.rangoMin !== undefined ? String(p.rangoMin) : "",
                              rangoMax: p.rangoMax !== undefined ? String(p.rangoMax) : "",
                              precision: p.precision ?? "",
                              ubicacion: p.ubicacion ?? "",
                              activo: p.activo,
                            });
                          }}
                        >
                          Editar
                        </button>
                      </div>
                    ) : (
                      <PatronFormInline
                        form={patronForm}
                        setForm={setPatronForm}
                        onSave={handleSavePatron}
                        onCancel={() => { setEditingPatronId(null); setPatronForm(emptyPatronForm()); setPatronError(""); }}
                        saving={savingPatron}
                        error={patronError}
                        isEdit
                      />
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

      </main>
    </div>
  );
}
