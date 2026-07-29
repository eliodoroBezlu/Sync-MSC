"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import type { OtBorrador, Plan, RosterItem, CuadrillaMatriz, CapacidadOverride } from "./types";
import type { TecnicoRef } from "./types";
import { tipoOtDisplay } from "@/lib/tiposOt";
import { calcularReporteCapacidad, horasDisponiblesGrupoDia } from "@/lib/planificacion/capacidad";
import { grupoDelDia } from "@/lib/planificacion/cuadrillas";
import { DIAS_INFO, GRUPOS_ORDEN, grupoColor } from "@/lib/planificacion/personal";
import CuadrillaEditor from "./CuadrillaEditor";
import PersonalRail from "./PersonalRail";
import { useProgramacionDnd } from "./useProgramacionDnd";
import type { EditCuadrillaFn, EditHHDiaFn, AlcanceGrupo } from "./useProgramacionDnd";
import { colorUtilizacion, CapacidadEditor, ResumenSemanal, AsignarGrupoPopover } from "./ResumenCapacidad";
import type { EditCapacidadFn } from "./ResumenCapacidad";

// Reparto de hhTotal en los días de la OT: si el día tiene una entrada en
// hhPorDiaManual (fijada a mano desde la tarjeta), se usa tal cual; el resto
// de hhTotal (descontando lo ya reservado en días con override) se reparte
// parejo entre los días sin override — así siempre suma exactamente hhTotal.
function hhPorDia(ot: Pick<OtBorrador, "hhTotal" | "dias" | "hhPorDiaManual">, dia: string): number {
  const manual = ot.hhPorDiaManual?.[dia];
  if (manual != null) return manual;
  const diasSinOverride = ot.dias.filter(d => ot.hhPorDiaManual?.[d] == null);
  const hhReservado = ot.dias.reduce((s, d) => s + (ot.hhPorDiaManual?.[d] ?? 0), 0);
  const hhRestante = Math.max(0, ot.hhTotal - hhReservado);
  return hhRestante / Math.max(1, diasSinOverride.length);
}

// En los días (no en Sin programar) los 6 grupos siempre se muestran, aunque
// no tengan ninguna OT ese día — así el planificador puede asignar
// manualmente (vía el formulario de edición de la OT) a un grupo vacío,
// igual que en la plantilla Excel "I-XX" (GRUPO 1-4 + TURNO DIURNO/NOCTURNO
// fijos todos los días).
// Agrupa por el grupo EFECTIVO de cada OT en `diaCode` (grupoPorDia[diaCode]
// si existe, si no el grupo base) — así una OT multi-día con un día puntual
// reasignado a otro grupo (ver moverAGrupoEnDia) aparece en la sección
// correcta de ESE día sin afectar el resto de sus días.
function agruparPorGrupo(ots: OtBorrador[], incluirVacios: boolean, diaCode: string): Array<{ grupo: string; ots: OtBorrador[] }> {
  const presentes = new Set(ots.map(o => grupoDelDia(o, diaCode)));
  const ordenados = incluirVacios ? [...GRUPOS_ORDEN] : GRUPOS_ORDEN.filter(g => presentes.has(g));
  for (const g of presentes) {
    if (!ordenados.includes(g)) ordenados.push(g);
  }
  return ordenados.map(grupo => ({ grupo, ots: ots.filter(o => grupoDelDia(o, diaCode) === grupo) }));
}

function getMondayOfIsoWeek(anio: number, semana: number): Date {
  const jan4 = new Date(anio, 0, 4);
  const dow = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  return monday;
}

type AsignarGrupoFn = (otId: string, diaCode: string, alcance: AlcanceGrupo) => void;

// ─── Tarjeta de OT ──────────────────────────────────────────────────────────
function OtCard({
  ot, enBacklog, disabled, isDragging, tecnicosDia, diaCode,
  onDragStart, onDragEnd, onDropTecnico, onQuitarTecnico, onClickBacklog, onDevolverABacklog, onEditarHH, onEditarHHDia, onAsignarGrupo,
}: {
  ot: OtBorrador; enBacklog: boolean; disabled: boolean; isDragging: boolean;
  tecnicosDia: TecnicoRef[]; diaCode: string;
  onDragStart: (e: DragEvent, otId: string) => void;
  onDragEnd: () => void;
  onDropTecnico: (e: DragEvent, otId: string) => void;
  onQuitarTecnico: (otId: string, nombre: string) => void;
  onClickBacklog: (ot: OtBorrador) => void;
  onDevolverABacklog: (otId: string) => void;
  onEditarHH: (otId: string, hhTotal: number) => void;
  onEditarHHDia: EditHHDiaFn;
  onAsignarGrupo: AsignarGrupoFn;
}) {
  const s = tipoOtDisplay(ot.tipoOT);
  const multiDia = ot.dias.length > 1;
  const grupoEsteDia = grupoDelDia(ot, diaCode);
  const grupoSobreescrito = grupoEsteDia !== ot.grupo;
  const horasEsteDia = hhPorDia(ot, diaCode);
  const manualEsteDia = ot.hhPorDiaManual?.[diaCode] != null;
  const [editandoHH, setEditandoHH] = useState(false);
  const [valorHH, setValorHH] = useState(String(multiDia ? horasEsteDia : ot.hhTotal));
  const [asignandoGrupo, setAsignandoGrupo] = useState(false);

  function empezarEdicion() {
    setValorHH(String(multiDia ? horasEsteDia : ot.hhTotal));
    setEditandoHH(true);
  }

  function guardarHH() {
    if (multiDia) {
      if (valorHH.trim() === "") {
        if (manualEsteDia) onEditarHHDia(ot.id, diaCode, null);
      } else {
        const n = Number(valorHH);
        // Solo fija un override si el valor realmente cambió respecto al
        // que ya se estaba mostrando (automático o manual). Sin este check,
        // cualquier clic que abra y cierre la edición sin tocar nada (ej. un
        // blur accidental durante un drag) congela el día en su valor
        // automático de ese instante, restándolo del total repartible entre
        // el resto de días — dejando días sin editar en 0HH sin que nadie
        // los haya tocado a propósito.
        if (Number.isFinite(n) && n >= 0 && n !== horasEsteDia) onEditarHHDia(ot.id, diaCode, n);
      }
    } else {
      const n = Number(valorHH);
      if (Number.isFinite(n) && n >= 0 && n !== ot.hhTotal) onEditarHH(ot.id, n);
    }
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
        <span
          style={{ fontSize: 9, color: grupoSobreescrito ? "#7c3aed" : "#94a3b8", fontWeight: grupoSobreescrito ? 800 : 600 }}
          title={grupoSobreescrito ? `Grupo base: ${ot.grupo} · este día: ${grupoEsteDia}` : undefined}
        >{grupoEsteDia}{grupoSobreescrito ? " ✎" : ""}{ot.personas > 1 ? ` · ${ot.personas}px` : ""}</span>
        {editandoHH ? (
          <input
            type="number" min={0} step={0.5} autoFocus
            value={valorHH}
            onClick={e => e.stopPropagation()}
            onChange={e => setValorHH(e.target.value)}
            onBlur={guardarHH}
            onKeyDown={e => { if (e.key === "Enter") guardarHH(); if (e.key === "Escape") { setValorHH(String(multiDia ? horasEsteDia : ot.hhTotal)); setEditandoHH(false); } }}
            style={{ width: 46, fontSize: 10, fontWeight: 700, textAlign: "right", borderRadius: 4, border: "1.5px solid #7c3aed", padding: "1px 3px" }}
          />
        ) : (
          <span
            onClick={e => { if (disabled) return; e.stopPropagation(); empezarEdicion(); }}
            title={
              disabled ? undefined
              : multiDia ? `Total ${ot.hhTotal}HH en ${ot.dias.length} días · este día: ${horasEsteDia.toFixed(1)}HH${manualEsteDia ? " (fijado a mano)" : " (reparto automático)"} — clic para editar, vaciar y Enter para volver a automático`
              : "Clic para editar HH"
            }
            style={{ fontSize: 10, color: "#374151", fontWeight: 700, cursor: disabled ? "default" : "pointer", borderBottom: disabled ? "none" : "1px dotted #cbd5e1" }}
          >
            {multiDia ? `${horasEsteDia.toFixed(1)}HH/día${manualEsteDia ? " ✎" : ""}` : `${ot.hhTotal}HH`}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <span style={{ fontSize: 9, color: "#cbd5e1", fontStyle: "italic" }}>Arrastra personal aquí →</span>
          <button
            onClick={e => { e.stopPropagation(); setAsignandoGrupo(v => !v); }}
            title={`Asignar todos los miembros de ${grupoEsteDia} a esta OT`}
            style={{
              border: "none", background: "none", color: "#7c3aed", cursor: "pointer",
              fontSize: 9, fontWeight: 700, padding: 0, flexShrink: 0,
            }}
          >+ Grupo</button>
        </div>
      )}
      {asignandoGrupo && (
        <AsignarGrupoPopover
          onClose={() => setAsignandoGrupo(false)}
          onElegir={alcance => onAsignarGrupo(ot.id, diaCode, alcance)}
        />
      )}
    </div>
  );
}

// ─── Columna de día ─────────────────────────────────────────────────────────
function DiaColumn({
  titulo, subtitulo, ots, esBacklog, diaCode, cuadrilla, roster, capacidadOverride, dragOverActivo, disabled,
  onDragOverColumna, onDragLeaveColumna, onDropColumna, onDropGrupo,
  draggingOtId, onDragStartOt, onDragEndOt, onDropTecnicoEnOt, onQuitarTecnico, onClickBacklog, onDevolverABacklog, onEditarHH, onEditarHHDia, onEditCuadrilla, onEditCapacidad, onAsignarGrupo,
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
  onEditarHHDia: EditHHDiaFn;
  onEditCuadrilla: EditCuadrillaFn;
  onEditCapacidad: EditCapacidadFn;
  onAsignarGrupo: AsignarGrupoFn;
}) {
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
  const [editandoCapacidad, setEditandoCapacidad] = useState<string | null>(null);
  const [dragOverGrupo, setDragOverGrupo] = useState<string | null>(null);
  const hh = esBacklog ? ots.reduce((s, o) => s + o.hhTotal, 0) : ots.reduce((s, o) => s + hhPorDia(o, diaCode), 0);
  // Utilización total del día: suma la HH disponible de los 6 grupos (aunque
  // no tengan OTs ese día) contra la HH programada — mismo cálculo que la
  // fila verde "UTILIZACION" del Excel I-XX, pero a nivel de columna/día en
  // vez de por grupo.
  const disponibleDia = esBacklog ? 0 : GRUPOS_ORDEN.reduce(
    (s, g) => s + horasDisponiblesGrupoDia(g, diaCode, cuadrilla, capacidadOverride).horasDisponibles, 0,
  );
  const pctUtilDia = disponibleDia > 0 ? hh / disponibleDia : 0;
  const ucDia = colorUtilizacion(pctUtilDia, disponibleDia);
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
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{ots.length} OT{ots.length !== 1 ? "s" : ""} · {hh.toFixed(1)}HH</div>
        {!esBacklog && (
          <div
            title="Utilización total del día: HH programada / HH disponible en los 6 grupos"
            style={{
              display: "inline-block", marginTop: 5, background: ucDia.bg, color: ucDia.color,
              borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800,
            }}
          >
            {hh.toFixed(0)}/{disponibleDia.toFixed(0)}HH · {(pctUtilDia * 100).toFixed(0)}%
          </div>
        )}
      </div>
      <div style={{
        display: "flex", flexDirection: "column", gap: 10, padding: 8, minHeight: 140, flex: 1,
        maxHeight: esBacklog ? "80vh" : undefined, overflowY: esBacklog ? "auto" : undefined,
      }}>
        {esBacklog && ots.length === 0 && (
          <p style={{ fontSize: 10, color: "#cbd5e1", textAlign: "center", padding: "18px 0", fontStyle: "italic" }}>
            Sin OTs pendientes
          </p>
        )}
        {agruparPorGrupo(ots, !esBacklog, diaCode).map(({ grupo, ots: otsGrupo }) => {
          const gc = grupoColor(grupo);
          const hhGrupo = esBacklog ? otsGrupo.reduce((s, o) => s + o.hhTotal, 0) : otsGrupo.reduce((s, o) => s + hhPorDia(o, diaCode), 0);
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
                  <span>{otsGrupo.length} · {hhGrupo.toFixed(1)}HH</span>
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
                    <span>{hhGrupo.toFixed(1)}/{cap.horasDisponibles.toFixed(0)}HH{cap.esManual ? " ✎" : ""}</span>
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
                  isDragging={draggingOtId === ot.id} diaCode={diaCode}
                  tecnicosDia={esBacklog ? [] : ot.personalAsignado
                    .filter(n => miembrosGrupo.some(t => t.nombre === n))
                    .map(n => miembrosGrupo.find(t => t.nombre === n)!)}
                  onDragStart={onDragStartOt} onDragEnd={onDragEndOt}
                  onDropTecnico={onDropTecnicoEnOt}
                  onQuitarTecnico={(otId, nombre) => onQuitarTecnico(otId, nombre, diaCode)}
                  onClickBacklog={onClickBacklog}
                  onDevolverABacklog={onDevolverABacklog}
                  onEditarHH={onEditarHH}
                  onEditarHHDia={onEditarHHDia}
                  onAsignarGrupo={onAsignarGrupo}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scrollbar espejo ───────────────────────────────────────────────────────
// El tablero de días puede quedar muy alto (muchas OTs), lo que empuja su
// scrollbar horizontal nativo fuera de la vista hasta bajar del todo. Esta
// barra delgada duplica ese scroll arriba del tablero, sincronizada en ambos
// sentidos con el contenedor real, para navegar entre días sin bajar primero.
function ScrollbarEspejo({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [anchoContenido, setAnchoContenido] = useState(0);
  const sincronizando = useRef(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const actualizarAncho = () => setAnchoContenido(el.scrollWidth);
    actualizarAncho();
    const ro = new ResizeObserver(actualizarAncho);
    ro.observe(el);
    for (const hijo of Array.from(el.children)) ro.observe(hijo);

    function onScrollTarget() {
      if (sincronizando.current || !barRef.current || !el) return;
      sincronizando.current = true;
      barRef.current.scrollLeft = el.scrollLeft;
      sincronizando.current = false;
    }
    el.addEventListener("scroll", onScrollTarget);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScrollTarget);
    };
  }, [targetRef]);

  function onScrollBar() {
    if (sincronizando.current || !barRef.current || !targetRef.current) return;
    sincronizando.current = true;
    targetRef.current.scrollLeft = barRef.current.scrollLeft;
    sincronizando.current = false;
  }

  return (
    <div
      ref={barRef}
      onScroll={onScrollBar}
      style={{ overflowX: "auto", overflowY: "hidden", marginBottom: 6, paddingLeft: 172 + 16 }}
    >
      <div style={{ width: anchoContenido, height: 1 }} />
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
  const [dragOverDia, setDragOverDia] = useState<string | null>(null);
  const diasScrollRef = useRef<HTMLDivElement>(null);

  const monday = getMondayOfIsoWeek(plan.anio, plan.semana);
  const reporte = calcularReporteCapacidad(plan.ots, cuadrilla, plan.capacidadOverride);

  const {
    draggingOtId, setDraggingOtId, moverADia, editarHH, editarHHDia,
    asignarGrupoCompleto, quitarTecnico,
    handleDragStartOt, handleDropColumna, handleDropGrupo, handleDropTecnicoEnOt,
  } = useProgramacionDnd({ plan, cuadrilla, onPatchOt, onEditCuadrilla });

  function otsDelDia(code: string): OtBorrador[] {
    if (code === "") return plan.ots.filter(o => !o.dias || o.dias.length === 0);
    return plan.ots.filter(o => o.dias?.includes(code));
  }

  function onDropColumnaWrap(e: DragEvent, dia: string) {
    setDragOverDia(null);
    handleDropColumna(e, dia);
  }

  function onDropGrupoWrap(e: DragEvent, dia: string, grupo: string) {
    setDragOverDia(null);
    handleDropGrupo(e, dia, grupo);
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
      <ScrollbarEspejo targetRef={diasScrollRef} />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <PersonalRail plan={plan} disabled={disabled} />

        {/* Fuera del riel de scroll horizontal (diasScrollRef) y sticky como
        PersonalRail: si el backlog viviera dentro de ese riel, se iría hacia
        la izquierda con el resto de columnas al hacer scroll vertical largo
        (tablero con muchas OTs por grupo), y el planificador perdería de
        vista justo las OTs sin programar que necesita arrastrar. */}
        <div style={{ position: "sticky", top: 60, flexShrink: 0 }}>
          <DiaColumn
            titulo="Sin programar" subtitulo="OTs importadas sin día"
            ots={otsDelDia("")} esBacklog diaCode="" cuadrilla={cuadrilla} roster={plan.roster} capacidadOverride={plan.capacidadOverride} disabled={disabled}
            dragOverActivo={dragOverDia === ""}
            onDragOverColumna={() => setDragOverDia("")}
            onDragLeaveColumna={() => setDragOverDia(null)}
            onDropColumna={e => onDropColumnaWrap(e, "")}
            onDropGrupo={() => {}}
            draggingOtId={draggingOtId}
            onDragStartOt={handleDragStartOt}
            onDragEndOt={() => setDraggingOtId(null)}
            onDropTecnicoEnOt={(e, otId) => handleDropTecnicoEnOt(e, otId, "")}
            onQuitarTecnico={quitarTecnico}
            onClickBacklog={clickAgregarBacklog}
            onDevolverABacklog={otId => moverADia(otId, "")}
            onEditarHH={editarHH}
            onEditarHHDia={editarHHDia}
            onEditCuadrilla={onEditCuadrilla}
            onEditCapacidad={onEditCapacidad}
            onAsignarGrupo={asignarGrupoCompleto}
          />
        </div>

        <div ref={diasScrollRef} style={{ display: "flex", gap: 10, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 10 }}>
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
                onDropColumna={e => onDropColumnaWrap(e, d.code)}
                onDropGrupo={(e, grupo) => onDropGrupoWrap(e, d.code, grupo)}
                draggingOtId={draggingOtId}
                onDragStartOt={handleDragStartOt}
                onDragEndOt={() => setDraggingOtId(null)}
                onDropTecnicoEnOt={(e, otId) => handleDropTecnicoEnOt(e, otId, d.code)}
                onQuitarTecnico={quitarTecnico}
                onClickBacklog={clickAgregarBacklog}
                onDevolverABacklog={otId => moverADia(otId, "")}
                onEditarHH={editarHH}
                onEditarHHDia={editarHHDia}
                onEditCuadrilla={onEditCuadrilla}
                onEditCapacidad={onEditCapacidad}
                onAsignarGrupo={asignarGrupoCompleto}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
