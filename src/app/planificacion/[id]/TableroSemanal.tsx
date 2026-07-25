"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import type { OtBorrador, Plan, RosterItem, CuadrillaMatriz, TecnicoRef } from "./types";
import { tipoOtDisplay } from "@/lib/tiposOt";
import { calcularDiasNecesarios, distribuirEnDias, DIAS_LABORALES } from "@/lib/planificacion/balanceador";
import CuadrillaEditor from "./CuadrillaEditor";

type EditCuadrillaFn = (
  grupo: string,
  dias: string[],
  agregar?: { nombre: string; usuarioId?: string | null }[],
  quitar?: string[],
) => Promise<void>;

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
function agruparPorGrupo(ots: OtBorrador[]): Array<{ grupo: string; ots: OtBorrador[] }> {
  const presentes = new Set(ots.map(o => o.grupo));
  const ordenados = GRUPOS_ORDEN.filter(g => presentes.has(g));
  for (const g of presentes) {
    if (!ordenados.includes(g)) ordenados.push(g);
  }
  return ordenados.map(grupo => ({ grupo, ots: ots.filter(o => o.grupo === grupo) }));
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

// Un técnico está "en sitio" esta semana si tiene T (trabajo), D (diurno) o
// N (nocturno) al menos un día — V/CS/L/"" son ausencias (vacación, comisión
// de servicio, licencia). Los ausentes toda la semana no se pueden arrastrar.
function estaEnSitio(asistencia: string[]): boolean {
  return asistencia.some(a => a === "T" || a === "D" || a === "N");
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
  titulo, subtitulo, ots, esBacklog, diaCode, cuadrilla, roster, dragOverActivo, disabled,
  onDragOverColumna, onDragLeaveColumna, onDropColumna,
  draggingOtId, onDragStartOt, onDragEndOt, onDropTecnicoEnOt, onQuitarTecnico, onClickBacklog, onDevolverABacklog, onEditarHH, onEditCuadrilla,
}: {
  titulo: string; subtitulo: string; ots: OtBorrador[]; esBacklog: boolean;
  diaCode: string; cuadrilla: CuadrillaMatriz; roster: RosterItem[];
  dragOverActivo: boolean; disabled: boolean;
  onDragOverColumna: () => void; onDragLeaveColumna: () => void; onDropColumna: (e: DragEvent) => void;
  draggingOtId: string | null;
  onDragStartOt: (e: DragEvent, otId: string) => void; onDragEndOt: () => void;
  onDropTecnicoEnOt: (e: DragEvent, otId: string) => void;
  onQuitarTecnico: (otId: string, nombre: string) => void;
  onClickBacklog: (ot: OtBorrador) => void;
  onDevolverABacklog: (otId: string) => void;
  onEditarHH: (otId: string, hhTotal: number) => void;
  onEditCuadrilla: EditCuadrillaFn;
}) {
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
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
        {ots.length === 0 && (
          <p style={{ fontSize: 10, color: "#cbd5e1", textAlign: "center", padding: "18px 0", fontStyle: "italic" }}>
            {esBacklog ? "Sin OTs pendientes" : "Vacío"}
          </p>
        )}
        {agruparPorGrupo(ots).map(({ grupo, ots: otsGrupo }) => {
          const gc = grupoColor(grupo);
          const hhGrupo = esBacklog ? otsGrupo.reduce((s, o) => s + o.hhTotal, 0) : otsGrupo.reduce((s, o) => s + hhPorDia(o), 0);
          const miembrosGrupo = cuadrilla[grupo]?.[diaCode] ?? [];
          return (
            <div key={grupo} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ position: "relative" }}>
                <div
                  onClick={() => { if (!esBacklog) setEditandoGrupo(editandoGrupo === grupo ? null : grupo); }}
                  style={{
                    background: gc.bg, color: gc.color, borderRadius: 6,
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
                  onQuitarTecnico={onQuitarTecnico}
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
  return (
    <div style={{ width: 172, flexShrink: 0, position: "sticky", top: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        Personal ({plan.roster.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
        {plan.roster.length === 0 && (
          <p style={{ fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>Importa el roster para asignar técnicos.</p>
        )}
        {plan.roster.map(r => {
          const asignaciones = plan.ots.filter(o => o.personalAsignado.includes(r.nombre)).length;
          const enSitio = estaEnSitio(r.asistencia);
          const bloqueado = disabled || !enSitio;
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
                opacity: draggingNombre === r.nombre ? 0.35 : enSitio ? 1 : 0.45,
                filter: enSitio ? undefined : "grayscale(1)",
                cursor: bloqueado ? "default" : "grab",
              }}
              title={
                !enSitio ? `${r.nombre} no está en sitio esta semana (vacación, comisión o licencia)`
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
                <div style={{ fontSize: 9, color: enSitio ? "#94a3b8" : "#dc2626" }}>
                  {enSitio ? `${r.grupo} · ${asignaciones} OT${asignaciones !== 1 ? "s" : ""}` : "Ausente esta semana"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tablero principal ──────────────────────────────────────────────────────
export default function TableroSemanal({
  plan, onPatchOt, cuadrilla, onEditCuadrilla, disabled,
}: {
  plan: Plan;
  onPatchOt: (otId: string, patch: Partial<OtBorrador>) => void;
  cuadrilla: CuadrillaMatriz;
  onEditCuadrilla: EditCuadrillaFn;
  disabled: boolean;
}) {
  const [draggingOtId, setDraggingOtId] = useState<string | null>(null);
  const [dragOverDia, setDragOverDia] = useState<string | null>(null);

  const monday = getMondayOfIsoWeek(plan.anio, plan.semana);

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

  async function asignarTecnico(otId: string, nombre: string, diaCode: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot || ot.personalAsignado.includes(nombre)) return;
    const yaEnCrew = (cuadrilla[ot.grupo]?.[diaCode] ?? []).some(t => t.nombre === nombre);
    if (diaCode && !yaEnCrew) {
      const r = plan.roster.find(x => x.nombre === nombre);
      await onEditCuadrilla(ot.grupo, [diaCode], [{ nombre, usuarioId: r?.usuarioId ?? null }]);
    }
    onPatchOt(otId, { personalAsignado: [...ot.personalAsignado, nombre] });
  }

  function quitarTecnico(otId: string, nombre: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
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
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <PersonalRail plan={plan} disabled={disabled} />

      <div style={{ display: "flex", gap: 10, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 10 }}>
        <DiaColumn
          titulo="Sin programar" subtitulo="OTs importadas sin día"
          ots={otsDelDia("")} esBacklog diaCode="" cuadrilla={cuadrilla} roster={plan.roster} disabled={disabled}
          dragOverActivo={dragOverDia === ""}
          onDragOverColumna={() => setDragOverDia("")}
          onDragLeaveColumna={() => setDragOverDia(null)}
          onDropColumna={e => handleDropColumna(e, "")}
          draggingOtId={draggingOtId}
          onDragStartOt={handleDragStartOt}
          onDragEndOt={() => setDraggingOtId(null)}
          onDropTecnicoEnOt={(e, otId) => handleDropTecnicoEnOt(e, otId, "")}
          onQuitarTecnico={quitarTecnico}
          onClickBacklog={clickAgregarBacklog}
          onDevolverABacklog={otId => moverADia(otId, "")}
          onEditarHH={editarHH}
          onEditCuadrilla={onEditCuadrilla}
        />
        {DIAS_INFO.map((d, i) => {
          const date = new Date(monday);
          date.setDate(monday.getDate() + i);
          return (
            <DiaColumn
              key={d.code}
              titulo={d.largo}
              subtitulo={date.toLocaleDateString("es-BO", { day: "2-digit", month: "short" })}
              ots={otsDelDia(d.code)} esBacklog={false} diaCode={d.code} cuadrilla={cuadrilla} roster={plan.roster} disabled={disabled}
              dragOverActivo={dragOverDia === d.code}
              onDragOverColumna={() => setDragOverDia(d.code)}
              onDragLeaveColumna={() => setDragOverDia(null)}
              onDropColumna={e => handleDropColumna(e, d.code)}
              draggingOtId={draggingOtId}
              onDragStartOt={handleDragStartOt}
              onDragEndOt={() => setDraggingOtId(null)}
              onDropTecnicoEnOt={(e, otId) => handleDropTecnicoEnOt(e, otId, d.code)}
              onQuitarTecnico={quitarTecnico}
              onClickBacklog={clickAgregarBacklog}
              onDevolverABacklog={otId => moverADia(otId, "")}
              onEditarHH={editarHH}
              onEditCuadrilla={onEditCuadrilla}
            />
          );
        })}
      </div>
    </div>
  );
}
