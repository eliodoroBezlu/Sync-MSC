"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import type { OtBorrador, Plan, RosterItem, CuadrillaMatriz, CapacidadOverride } from "./types";
import type { TecnicoRef } from "./types";
import { tipoOtDisplay } from "@/lib/tiposOt";
import { calcularDiasNecesarios, distribuirEnDias, DIAS_LABORALES } from "@/lib/planificacion/balanceador";
import { calcularReporteCapacidad, horasDisponiblesGrupoDia } from "@/lib/planificacion/capacidad";
import CuadrillaEditor from "./CuadrillaEditor";

type EditCuadrillaFn = (
  grupo: string,
  dias: string[],
  agregar?: { nombre: string; usuarioId?: string | null }[],
  quitar?: string[],
) => Promise<void>;

type EditCapacidadFn = (grupo: string, dia: string, horas: number | null) => void;

function hhPorDia(ot: Pick<OtBorrador, "hhTotal" | "dias">): number {
  return ot.hhTotal / Math.max(1, ot.dias.length);
}

const DIAS_INFO = [
  { code: "Lu", largo: "Lunes" },
  { code: "Ma", largo: "Martes" },
  { code: "Mi", largo: "Miércoles" },
  { code: "Ju", largo: "Jueves" },
  { code: "Vi", largo: "Viernes" },
  { code: "Sa", largo: "Sábado" },
  { code: "Do", largo: "Domingo" },
] as const;

// Mismo orden y colores que el Plan Semanal publicado (src/app/ordenes/semanales)
// para que la agrupación por turno se vea consistente en ambas pantallas.
const GRUPOS_ORDEN = ["G1", "G2", "G3", "G4", "Diurno", "Nocturno"];
const GRUPO_COLOR: Record<string, { bg: string; color: string }> = {
  G1: { bg: "#dbeafe", color: "#1d4ed8" },
  G2: { bg: "#dcfce7", color: "#166534" },
  G3: { bg: "#fef3c7", color: "#92400e" },
  G4: { bg: "#ede9fe", color: "#5b21b6" },
  Diurno: { bg: "#ffedd5", color: "#9a3412" },
  Nocturno: { bg: "#1e293b", color: "#e2e8f0" },
};
function grupoColor(g: string) {
  return GRUPO_COLOR[g] ?? { bg: "#f1f5f9", color: "#475569" };
}
// En los días (no en Sin programar) los 6 grupos siempre se muestran, aunque
// no tengan ninguna OT ese día — así el planificador puede asignar
// manualmente (vía el formulario de edición de la OT) a un grupo vacío,
// igual que en la plantilla Excel "I-XX" (GRUPO 1-4 + TURNO DIURNO/NOCTURNO
// fijos todos los días).
function agruparPorGrupo(ots: OtBorrador[], incluirVacios: boolean): Array<{ grupo: string; ots: OtBorrador[] }> {
  const presentes = new Set(ots.map(o => o.grupo));
  const ordenados = incluirVacios ? [...GRUPOS_ORDEN] : GRUPOS_ORDEN.filter(g => presentes.has(g));
  for (const g of presentes) {
    if (!ordenados.includes(g)) ordenados.push(g);
  }
  return ordenados.map(grupo => ({ grupo, ots: ots.filter(o => o.grupo === grupo) }));
}

function colorUtilizacion(pct: number, disponible: number): { bg: string; color: string } {
  if (disponible <= 0) return { bg: "#f1f5f9", color: "#94a3b8" };
  if (pct > 1) return { bg: "#fee2e2", color: "#dc2626" };
  if (pct >= 0.85) return { bg: "#fef3c7", color: "#b45309" };
  return { bg: "#dcfce7", color: "#15803d" };
}

// Popover para ajustar manualmente las horas-hombre disponibles de un
// grupo en un día puntual (ej. alguien avisó que hoy solo vienen 3 de 4).
// Sin ajuste, la capacidad sale automática: headcount de la cuadrilla × 10h.
function CapacidadEditor({
  grupo, dia, headcount, horasAuto, horasActual, esManual, disabled, onClose, onEdit,
}: {
  grupo: string; dia: string; headcount: number; horasAuto: number; horasActual: number; esManual: boolean;
  disabled: boolean; onClose: () => void; onEdit: EditCapacidadFn;
}) {
  const [valor, setValor] = useState(String(horasActual));

  function guardar() {
    const n = Number(valor);
    if (Number.isFinite(n) && n >= 0) onEdit(grupo, dia, n);
    onClose();
  }
  function volverAutomatico() {
    onEdit(grupo, dia, null);
    onClose();
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", zIndex: 30, top: "100%", left: 0, marginTop: 4,
        width: 190, background: "white", borderRadius: 10, border: "1px solid #e2e8f0",
        boxShadow: "0 8px 24px rgba(15,40,71,0.18)", padding: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#374151" }}>{grupo} · {dia} · HH disp.</span>
        <button onClick={onClose} style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>
        Automático: {headcount} pers. × 10h = {horasAuto.toFixed(0)}HH
      </div>
      {disabled ? (
        <div style={{ fontSize: 11, color: "#374151" }}>{horasActual.toFixed(0)}HH {esManual ? "(manual)" : "(automático)"}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            <input
              type="number" min={0} step={1} autoFocus value={valor}
              onChange={e => setValor(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") guardar(); if (e.key === "Escape") onClose(); }}
              style={{ flex: 1, fontSize: 11, borderRadius: 6, border: "1.5px solid #7c3aed", padding: "3px 6px" }}
            />
            <button onClick={guardar} style={{ padding: "3px 10px", borderRadius: 6, border: "none", background: "#7c3aed", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>OK</button>
          </div>
          {esManual && (
            <button onClick={volverAutomatico} style={{ border: "none", background: "none", color: "#0891b2", cursor: "pointer", fontSize: 10, fontWeight: 700, padding: 0 }}>
              ↺ Volver a automático
            </button>
          )}
        </>
      )}
    </div>
  );
}

function getMondayOfIsoWeek(anio: number, semana: number): Date {
  const jan4 = new Date(anio, 0, 4);
  const dow = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  return monday;
}

type DragPayload = { tipo: "ot"; id: string } | { tipo: "tecnico"; nombre: string };

function leerPayload(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData("application/json");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

// Un técnico está "en sitio" esta semana si tiene T (turno normal/guardia
// diurna) o N (turno nocturno) al menos un día — D es descanso (código de
// RRHH, no "diurno" pese a la letra) y V/CS/L/"" son ausencias (vacación,
// comisión de servicio, licencia). Los ausentes toda la semana no se pueden
// arrastrar.
function estaEnSitio(asistencia: string[]): boolean {
  return asistencia.some(a => a === "T" || a === "N");
}

// Mismo criterio T/N que estaEnSitio, pero para un día puntual — usado para
// bloquear el drop de un técnico sobre un día en el que no está en sitio
// (entra/sale a mitad de semana, o tiene descanso ese día).
function trabajaEseDia(asistencia: string[], diaCode: string): boolean {
  const idx = DIAS_INFO.findIndex(d => d.code === diaCode);
  if (idx === -1) return true;
  const a = asistencia[idx];
  return a === "T" || a === "N";
}

// ─── Tarjeta de OT ──────────────────────────────────────────────────────────
function OtCard({
  ot, enBacklog, disabled, isDragging, tecnicosDia,
  onDragStart, onDragEnd, onDropTecnico, onQuitarTecnico, onClickBacklog, onDevolverABacklog, onEditarHH,
}: {
  ot: OtBorrador; enBacklog: boolean; disabled: boolean; isDragging: boolean;
  tecnicosDia: TecnicoRef[];
  onDragStart: (e: DragEvent, otId: string) => void;
  onDragEnd: () => void;
  onDropTecnico: (e: DragEvent, otId: string) => void;
  onQuitarTecnico: (otId: string, nombre: string) => void;
  onClickBacklog: (ot: OtBorrador) => void;
  onDevolverABacklog: (otId: string) => void;
  onEditarHH: (otId: string, hhTotal: number) => void;
}) {
  const s = tipoOtDisplay(ot.tipoOT);
  const [editandoHH, setEditandoHH] = useState(false);
  const [valorHH, setValorHH] = useState(String(ot.hhTotal));
  const multiDia = ot.dias.length > 1;

  function guardarHH() {
    const n = Number(valorHH);
    if (Number.isFinite(n) && n >= 0 && n !== ot.hhTotal) onEditarHH(ot.id, n);
    setEditandoHH(false);
  }

  return (
    <div
      draggable={!disabled}
      onDragStart={e => onDragStart(e, ot.id)}
      onDragEnd={onDragEnd}
      onDragOver={e => { if (!disabled) e.preventDefault(); }}
      onDrop={e => onDropTecnico(e, ot.id)}
      onClick={() => enBacklog && onClickBacklog(ot)}
      style={{
        background: "white", borderRadius: 10, border: "1px solid #f1f5f9",
        padding: 9, boxShadow: "0 1px 3px rgba(15,40,71,0.06)",
        opacity: isDragging ? 0.35 : 1,
        cursor: disabled ? "default" : enBacklog ? "pointer" : "grab",
        transition: "opacity 0.15s",
        position: "relative",
      }}
      title={enBacklog && !disabled ? "Clic para agregar a la semana · arrastra a un día" : undefined}
    >
      {!enBacklog && !disabled && (
        <button
          onClick={e => { e.stopPropagation(); onDevolverABacklog(ot.id); }}
          title="Devolver a Sin programar"
          style={{
            position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 4,
            border: "none", background: "#f1f5f9", color: "#94a3b8", fontSize: 10, lineHeight: "16px",
            cursor: "pointer", padding: 0,
          }}
        >↩</button>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4, paddingRight: enBacklog ? 0 : 18 }}>
        <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 11, color: "#0f2847" }}>{ot.numeroOT}</span>
        <span style={{ background: s.color.bg, color: s.color.color, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{s.texto}</span>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", marginTop: 3 }}>{ot.tag}</div>
      <div style={{
        fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.35,
        overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
      }}>{ot.descripcion}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{ot.grupo}{ot.personas > 1 ? ` · ${ot.personas}px` : ""}</span>
        {editandoHH ? (
          <input
            type="number" min={0} step={1} autoFocus
            value={valorHH}
            onClick={e => e.stopPropagation()}
            onChange={e => setValorHH(e.target.value)}
            onBlur={guardarHH}
            onKeyDown={e => { if (e.key === "Enter") guardarHH(); if (e.key === "Escape") { setValorHH(String(ot.hhTotal)); setEditandoHH(false); } }}
            style={{ width: 46, fontSize: 10, fontWeight: 700, textAlign: "right", borderRadius: 4, border: "1.5px solid #7c3aed", padding: "1px 3px" }}
          />
        ) : (
          <span
            onClick={e => { if (disabled) return; e.stopPropagation(); setValorHH(String(ot.hhTotal)); setEditandoHH(true); }}
            title={disabled ? undefined : multiDia ? `Total ${ot.hhTotal}HH repartidas en ${ot.dias.length} días — clic para editar` : "Clic para editar HH"}
            style={{ fontSize: 10, color: "#374151", fontWeight: 700, cursor: disabled ? "default" : "pointer", borderBottom: disabled ? "none" : "1px dotted #cbd5e1" }}
          >
            {multiDia ? `${hhPorDia(ot).toFixed(0)}HH/día` : `${ot.hhTotal}HH`}
          </span>
        )}
      </div>
      {!enBacklog && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6, borderTop: "1px solid #f1f5f9", paddingTop: 5 }}>
          {tecnicosDia.length === 0 && (
            <span style={{ fontSize: 9, color: "#cbd5e1", fontStyle: "italic" }}>Sin cuadrilla este día</span>
          )}
          {tecnicosDia.map(t => (
            <span key={t.nombre} style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              background: "#ecfdf5", color: "#047857", borderRadius: 10,
              padding: "1px 5px 1px 7px", fontSize: 9, fontWeight: 700,
            }}>
              {t.nombre}
              {!disabled && (
                <button
                  onClick={e => { e.stopPropagation(); onQuitarTecnico(ot.id, t.nombre); }}
                  style={{ border: "none", background: "none", color: "#047857", cursor: "pointer", fontSize: 10, padding: 0, lineHeight: 1 }}
                >×</button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && !enBacklog && (
        <div style={{ fontSize: 9, color: "#cbd5e1", marginTop: 4, fontStyle: "italic" }}>Arrastra personal aquí →</div>
      )}
    </div>
  );
}

// ─── Columna de día ─────────────────────────────────────────────────────────
function DiaColumn({
  titulo, subtitulo, ots, esBacklog, diaCode, cuadrilla, roster, capacidadOverride, dragOverActivo, disabled,
  onDragOverColumna, onDragLeaveColumna, onDropColumna, onDropGrupo,
  draggingOtId, onDragStartOt, onDragEndOt, onDropTecnicoEnOt, onQuitarTecnico, onClickBacklog, onDevolverABacklog, onEditarHH, onEditCuadrilla, onEditCapacidad,
}: {
  titulo: string; subtitulo: string; ots: OtBorrador[]; esBacklog: boolean;
  diaCode: string; cuadrilla: CuadrillaMatriz; roster: RosterItem[]; capacidadOverride: CapacidadOverride;
  dragOverActivo: boolean; disabled: boolean;
  onDragOverColumna: () => void; onDragLeaveColumna: () => void; onDropColumna: (e: DragEvent) => void;
  onDropGrupo: (e: DragEvent, grupo: string) => void;
  draggingOtId: string | null;
  onDragStartOt: (e: DragEvent, otId: string) => void; onDragEndOt: () => void;
  onDropTecnicoEnOt: (e: DragEvent, otId: string) => void;
  onQuitarTecnico: (otId: string, nombre: string, diaCode: string) => void;
  onClickBacklog: (ot: OtBorrador) => void;
  onDevolverABacklog: (otId: string) => void;
  onEditarHH: (otId: string, hhTotal: number) => void;
  onEditCuadrilla: EditCuadrillaFn;
  onEditCapacidad: EditCapacidadFn;
}) {
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
  const [editandoCapacidad, setEditandoCapacidad] = useState<string | null>(null);
  const [dragOverGrupo, setDragOverGrupo] = useState<string | null>(null);
  const hh = esBacklog ? ots.reduce((s, o) => s + o.hhTotal, 0) : ots.reduce((s, o) => s + hhPorDia(o), 0);
  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOverColumna(); }}
      onDragLeave={onDragLeaveColumna}
      onDrop={onDropColumna}
      style={{
        width: 224, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRadius: 12, border: `1.5px ${esBacklog ? "dashed" : "solid"} ${dragOverActivo ? "#7c3aed" : "#e2e8f0"}`,
        background: dragOverActivo ? "#7c3aed08" : esBacklog ? "#f8fafc" : "white",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: esBacklog ? "#64748b" : "#0f2847" }}>{titulo}</div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{subtitulo}</div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{ots.length} OT{ots.length !== 1 ? "s" : ""} · {hh.toFixed(0)}HH</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 8, minHeight: 140, flex: 1 }}>
        {esBacklog && ots.length === 0 && (
          <p style={{ fontSize: 10, color: "#cbd5e1", textAlign: "center", padding: "18px 0", fontStyle: "italic" }}>
            Sin OTs pendientes
          </p>
        )}
        {agruparPorGrupo(ots, !esBacklog).map(({ grupo, ots: otsGrupo }) => {
          const gc = grupoColor(grupo);
          const hhGrupo = esBacklog ? otsGrupo.reduce((s, o) => s + o.hhTotal, 0) : otsGrupo.reduce((s, o) => s + hhPorDia(o), 0);
          const miembrosGrupo = cuadrilla[grupo]?.[diaCode] ?? [];
          const cap = esBacklog ? null : horasDisponiblesGrupoDia(grupo, diaCode, cuadrilla, capacidadOverride);
          const pctUtil = cap && cap.horasDisponibles > 0 ? hhGrupo / cap.horasDisponibles : 0;
          const uc = cap ? colorUtilizacion(pctUtil, cap.horasDisponibles) : null;
          return (
            <div
              key={grupo}
              onDragOver={esBacklog ? undefined : e => { e.preventDefault(); e.stopPropagation(); setDragOverGrupo(grupo); }}
              onDragLeave={esBacklog ? undefined : () => setDragOverGrupo(g => (g === grupo ? null : g))}
              onDrop={esBacklog ? undefined : e => { setDragOverGrupo(null); onDropGrupo(e, grupo); }}
              style={{
                display: "flex", flexDirection: "column", gap: 7,
                borderRadius: 6,
                outline: dragOverGrupo === grupo ? "2px dashed #7c3aed" : "none",
                outlineOffset: 2,
                background: dragOverGrupo === grupo ? "#7c3aed0f" : "transparent",
                transition: "background 0.1s",
              }}
            >
              <div style={{ position: "relative" }}>
                <div
                  onClick={() => { if (!esBacklog) setEditandoGrupo(editandoGrupo === grupo ? null : grupo); }}
                  style={{
                    background: gc.bg, color: gc.color, borderRadius: "6px 6px 0 0",
                    padding: "3px 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.03em",
                    display: "flex", justifyContent: "space-between",
                    cursor: esBacklog ? "default" : "pointer",
                  }}
                  title={esBacklog ? undefined : `Editar cuadrilla ${grupo} · ${titulo}`}
                >
                  <span>{grupo.toUpperCase()}</span>
                  <span>{otsGrupo.length} · {hhGrupo.toFixed(0)}HH</span>
                </div>
                {editandoGrupo === grupo && !esBacklog && (
                  <CuadrillaEditor
                    grupo={grupo} dia={diaCode} miembros={miembrosGrupo} roster={roster}
                    disabled={disabled}
                    onClose={() => setEditandoGrupo(null)}
                    onEdit={onEditCuadrilla}
                  />
                )}
                {cap && uc && (
                  <div
                    onClick={() => setEditandoCapacidad(editandoCapacidad === grupo ? null : grupo)}
                    style={{
                      background: uc.bg, color: uc.color, borderRadius: "0 0 6px 6px",
                      padding: "2px 8px", fontSize: 9, fontWeight: 700,
                      display: "flex", justifyContent: "space-between", cursor: disabled ? "default" : "pointer",
                    }}
                    title={disabled ? undefined : `Ajustar HH disponibles de ${grupo} · ${titulo}`}
                  >
                    <span>{hhGrupo.toFixed(0)}/{cap.horasDisponibles.toFixed(0)}HH{cap.esManual ? " ✎" : ""}</span>
                    <span>{(pctUtil * 100).toFixed(0)}%</span>
                  </div>
                )}
                {editandoCapacidad === grupo && cap && !disabled && (
                  <CapacidadEditor
                    grupo={grupo} dia={diaCode}
                    headcount={cap.headcount} horasAuto={cap.headcount * 10}
                    horasActual={cap.horasDisponibles} esManual={cap.esManual}
                    disabled={disabled}
                    onClose={() => setEditandoCapacidad(null)}
                    onEdit={onEditCapacidad}
                  />
                )}
              </div>
              {otsGrupo.map(ot => (
                <OtCard
                  key={ot.id} ot={ot} enBacklog={esBacklog} disabled={disabled}
                  isDragging={draggingOtId === ot.id}
                  tecnicosDia={esBacklog ? [] : ot.personalAsignado
                    .filter(n => miembrosGrupo.some(t => t.nombre === n))
                    .map(n => miembrosGrupo.find(t => t.nombre === n)!)}
                  onDragStart={onDragStartOt} onDragEnd={onDragEndOt}
                  onDropTecnico={onDropTecnicoEnOt}
                  onQuitarTecnico={(otId, nombre) => onQuitarTecnico(otId, nombre, diaCode)}
                  onClickBacklog={onClickBacklog}
                  onDevolverABacklog={onDevolverABacklog}
                  onEditarHH={onEditarHH}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Riel de personal ───────────────────────────────────────────────────────
function PersonalRail({ plan, disabled }: { plan: Plan; disabled: boolean }) {
  const [draggingNombre, setDraggingNombre] = useState<string | null>(null);
  const visibles = plan.roster.filter(r => estaEnSitio(r.asistencia));
  const ausentes = plan.roster.length - visibles.length;
  return (
    <div style={{ width: 172, flexShrink: 0, position: "sticky", top: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#374151", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        Personal ({visibles.length})
      </div>
      {ausentes > 0 && (
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 6 }}>
          {ausentes} ausente{ausentes !== 1 ? "s" : ""} toda la semana (no se muestran)
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
        {plan.roster.length === 0 && (
          <p style={{ fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>Importa el roster para asignar técnicos.</p>
        )}
        {visibles.map(r => {
          const asignaciones = plan.ots.filter(o => o.personalAsignado.includes(r.nombre)).length;
          const diasTrabaja = DIAS_INFO.map(d => trabajaEseDia(r.asistencia, d.code));
          const semanaCompleta = diasTrabaja.every(Boolean);
          const bloqueado = disabled;
          return (
            <div
              key={r.id}
              draggable={!bloqueado}
              onDragStart={e => {
                setDraggingNombre(r.nombre);
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData("application/json", JSON.stringify({ tipo: "tecnico", nombre: r.nombre }));
              }}
              onDragEnd={() => setDraggingNombre(null)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "white", border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 8px",
                opacity: draggingNombre === r.nombre ? 0.35 : 1,
                cursor: bloqueado ? "default" : "grab",
              }}
              title={
                !semanaCompleta ? `${r.nombre} solo está en sitio: ${DIAS_INFO.filter((_, i) => diasTrabaja[i]).map(d => d.largo).join(", ")}`
                : disabled ? undefined : "Arrastra sobre una OT para asignar"
              }
            >
              <span style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                background: r.grupo === "Nocturno" ? "#1e1b4b" : "#ede9fe",
                color: r.grupo === "Nocturno" ? "white" : "#7c3aed",
                fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{iniciales(r.nombre)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0f2847", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</div>
                <div style={{ fontSize: 9, color: "#94a3b8" }}>
                  {r.grupo} · {asignaciones} OT{asignaciones !== 1 ? "s" : ""}
                </div>
                {!semanaCompleta && (
                  <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
                    {DIAS_INFO.map((d, i) => (
                      <span
                        key={d.code}
                        title={`${d.largo}${diasTrabaja[i] ? "" : " (no está en sitio)"}`}
                        style={{
                          width: 12, height: 12, borderRadius: 3, fontSize: 7, fontWeight: 800,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: diasTrabaja[i] ? "#ddd6fe" : "#f1f5f9",
                          color: diasTrabaja[i] ? "#5b21b6" : "#cbd5e1",
                        }}
                      >{d.code[0]}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Resumen semanal de HH (réplica de las filas 1-8 de la hoja I-XX) ─────
function ResumenSemanal({ reporte }: { reporte: ReturnType<typeof calcularReporteCapacidad> }) {
  const uc = colorUtilizacion(reporte.utilizacionSemana, reporte.totalDisponible);
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
      background: "white", border: "1px solid #f1f5f9", borderRadius: 10,
      padding: "9px 14px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", gap: 16 }}>
        <div>
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Disponible</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f2847" }}>{reporte.totalDisponible.toFixed(0)}HH</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Programada</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f2847" }}>{reporte.totalProgramada.toFixed(0)}HH</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Atención reactivo</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: reporte.horasReactivo >= 0 ? "#0f2847" : "#dc2626" }}>{reporte.horasReactivo.toFixed(0)}HH</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Utilización semana</div>
          <div style={{ display: "inline-block", background: uc.bg, color: uc.color, borderRadius: 6, padding: "1px 8px", fontSize: 13, fontWeight: 800 }}>
            {(reporte.utilizacionSemana * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
        {reporte.porGrupo.map(g => {
          const gc = grupoColor(g.grupo);
          const guc = colorUtilizacion(g.utilizacionPromedio, 1);
          return (
            <div key={g.grupo} style={{ display: "flex", alignItems: "center", gap: 4, background: gc.bg, borderRadius: 6, padding: "3px 8px" }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: gc.color }}>{g.grupo.toUpperCase()}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: guc.color }}>{(g.utilizacionPromedio * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tablero principal ──────────────────────────────────────────────────────
export default function TableroSemanal({
  plan, onPatchOt, cuadrilla, onEditCuadrilla, onEditCapacidad, disabled,
}: {
  plan: Plan;
  onPatchOt: (otId: string, patch: Partial<OtBorrador>) => void;
  cuadrilla: CuadrillaMatriz;
  onEditCuadrilla: EditCuadrillaFn;
  onEditCapacidad: EditCapacidadFn;
  disabled: boolean;
}) {
  const [draggingOtId, setDraggingOtId] = useState<string | null>(null);
  const [dragOverDia, setDragOverDia] = useState<string | null>(null);

  const monday = getMondayOfIsoWeek(plan.anio, plan.semana);
  const reporte = calcularReporteCapacidad(plan.ots, cuadrilla, plan.capacidadOverride);

  function otsDelDia(code: string): OtBorrador[] {
    if (code === "") return plan.ots.filter(o => !o.dias || o.dias.length === 0);
    return plan.ots.filter(o => o.dias?.includes(code));
  }

  function moverADia(otId: string, dia: string) {
    if (dia === "") { onPatchOt(otId, { dias: [] }); return; }
    const ot = plan.ots.find(o => o.id === otId);
    // OTs de guardia u OPEPLANT quedan en el día exacto donde se soltaron;
    // el resto se reparte automáticamente en tantos días hábiles como haga
    // falta según personas/hrsTrabajo y el turno (8h/10h por persona/día).
    if (ot && !ot.esGuardia && DIAS_LABORALES.includes(dia)) {
      const diasNecesarios = calcularDiasNecesarios(ot.hhTotal, ot.personas, ot.grupo);
      onPatchOt(otId, { dias: distribuirEnDias(dia, diasNecesarios) });
    } else {
      onPatchOt(otId, { dias: [dia] });
    }
  }

  function editarHH(otId: string, hhTotal: number) {
    onPatchOt(otId, { hhTotal });
  }

  // Arrastrar una OT y soltarla sobre la sección de un grupo (G1-G4/Diurno/
  // Nocturno) dentro de un día: fija el grupo a mano (grupoManual=true, ver
  // ots/[otId]/route.ts) para que Balancear ya no la mueva. Si la OT viene de
  // otro día o de Sin programar, además hay que ubicarla en este día, igual
  // que moverADia.
  function moverAGrupoEnDia(otId: string, dia: string, grupo: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    const yaEnEsteDia = ot.dias?.includes(dia) ?? false;
    if (yaEnEsteDia) {
      onPatchOt(otId, { grupo });
      return;
    }
    if (!ot.esGuardia && DIAS_LABORALES.includes(dia)) {
      const diasNecesarios = calcularDiasNecesarios(ot.hhTotal, ot.personas, grupo);
      onPatchOt(otId, { dias: distribuirEnDias(dia, diasNecesarios), grupo });
    } else {
      onPatchOt(otId, { dias: [dia], grupo });
    }
  }

  async function asignarTecnico(otId: string, nombre: string, diaCode: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    const tecnico = plan.roster.find(r => r.nombre === nombre);
    if (diaCode && tecnico && !trabajaEseDia(tecnico.asistencia, diaCode)) {
      const dia = DIAS_INFO.find(d => d.code === diaCode)?.largo ?? diaCode;
      alert(`${nombre} no está en sitio el ${dia}. No se puede asignar ese día.`);
      return;
    }
    // No usar early-return por "ya está en personalAsignado": una OT de
    // guardia (OPEPLANT) abarca toda la semana en un solo registro, así que
    // dropear al mismo técnico en un día distinto debe seguir registrando su
    // membresía de cuadrilla para ESE día aunque ya figure en la OT.
    const yaEnCrew = (cuadrilla[ot.grupo]?.[diaCode] ?? []).some(t => t.nombre === nombre);
    if (diaCode && !yaEnCrew) {
      const r = plan.roster.find(x => x.nombre === nombre);
      await onEditCuadrilla(ot.grupo, [diaCode], [{ nombre, usuarioId: r?.usuarioId ?? null }]);
    }
    if (!ot.personalAsignado.includes(nombre)) {
      onPatchOt(otId, { personalAsignado: [...ot.personalAsignado, nombre] });
    }
  }

  async function quitarTecnico(otId: string, nombre: string, diaCode: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    if (ot.esGuardia && diaCode) {
      // OT de guardia (OPEPLANT): abarca toda la semana en un solo registro
      // (dias = Lu-Do), así que sacar a alguien de un día puntual debe tocar
      // solo la membresía de cuadrilla de ESE día — nunca personalAsignado
      // directo, que lo sacaría de la OT los 7 días a la vez. El PATCH de
      // cuadrillas ya reconcilia personalAsignado en el servidor dejándolo
      // solo si sigue siendo elegible en algún otro día de la semana.
      await onEditCuadrilla(ot.grupo, [diaCode], undefined, [nombre]);
      return;
    }
    onPatchOt(otId, { personalAsignado: ot.personalAsignado.filter(n => n !== nombre) });
  }

  function handleDragStartOt(e: DragEvent, otId: string) {
    setDraggingOtId(otId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify({ tipo: "ot", id: otId }));
  }

  function handleDropColumna(e: DragEvent, dia: string) {
    e.preventDefault();
    setDragOverDia(null);
    const payload = leerPayload(e);
    if (payload?.tipo === "ot") moverADia(payload.id, dia);
  }

  function handleDropGrupo(e: DragEvent, dia: string, grupo: string) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDia(null);
    const payload = leerPayload(e);
    if (payload?.tipo === "ot") moverAGrupoEnDia(payload.id, dia, grupo);
  }

  function handleDropTecnicoEnOt(e: DragEvent, otId: string, diaCode: string) {
    const payload = leerPayload(e);
    if (payload?.tipo === "tecnico") {
      e.preventDefault();
      e.stopPropagation();
      asignarTecnico(otId, payload.nombre, diaCode);
    }
    // Si es una OT arrastrada sobre otra tarjeta, dejar que el evento burbujee
    // hasta la columna para que se procese como un cambio de día.
  }

  function clickAgregarBacklog(ot: OtBorrador) {
    if (disabled) return;
    const hoy = new Date();
    let code = "Lu";
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      if (d.toDateString() === hoy.toDateString()) { code = DIAS_INFO[i].code; break; }
    }
    moverADia(ot.id, code);
  }

  return (
    <div>
      <ResumenSemanal reporte={reporte} />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <PersonalRail plan={plan} disabled={disabled} />

        <div style={{ display: "flex", gap: 10, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 10 }}>
          <DiaColumn
            titulo="Sin programar" subtitulo="OTs importadas sin día"
            ots={otsDelDia("")} esBacklog diaCode="" cuadrilla={cuadrilla} roster={plan.roster} capacidadOverride={plan.capacidadOverride} disabled={disabled}
            dragOverActivo={dragOverDia === ""}
            onDragOverColumna={() => setDragOverDia("")}
            onDragLeaveColumna={() => setDragOverDia(null)}
            onDropColumna={e => handleDropColumna(e, "")}
            onDropGrupo={() => {}}
            draggingOtId={draggingOtId}
            onDragStartOt={handleDragStartOt}
            onDragEndOt={() => setDraggingOtId(null)}
            onDropTecnicoEnOt={(e, otId) => handleDropTecnicoEnOt(e, otId, "")}
            onQuitarTecnico={quitarTecnico}
            onClickBacklog={clickAgregarBacklog}
            onDevolverABacklog={otId => moverADia(otId, "")}
            onEditarHH={editarHH}
            onEditCuadrilla={onEditCuadrilla}
            onEditCapacidad={onEditCapacidad}
          />
          {DIAS_INFO.map((d, i) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            return (
              <DiaColumn
                key={d.code}
                titulo={d.largo}
                subtitulo={date.toLocaleDateString("es-BO", { day: "2-digit", month: "short" })}
                ots={otsDelDia(d.code)} esBacklog={false} diaCode={d.code} cuadrilla={cuadrilla} roster={plan.roster} capacidadOverride={plan.capacidadOverride} disabled={disabled}
                dragOverActivo={dragOverDia === d.code}
                onDragOverColumna={() => setDragOverDia(d.code)}
                onDragLeaveColumna={() => setDragOverDia(null)}
                onDropColumna={e => handleDropColumna(e, d.code)}
                onDropGrupo={(e, grupo) => handleDropGrupo(e, d.code, grupo)}
                draggingOtId={draggingOtId}
                onDragStartOt={handleDragStartOt}
                onDragEndOt={() => setDraggingOtId(null)}
                onDropTecnicoEnOt={(e, otId) => handleDropTecnicoEnOt(e, otId, d.code)}
                onQuitarTecnico={quitarTecnico}
                onClickBacklog={clickAgregarBacklog}
                onDevolverABacklog={otId => moverADia(otId, "")}
                onEditarHH={editarHH}
                onEditCuadrilla={onEditCuadrilla}
                onEditCapacidad={onEditCapacidad}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
