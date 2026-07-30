"use client";

import { Fragment, useState } from "react";
import type { DragEvent } from "react";
import type { OtBorrador, Plan, CuadrillaMatriz } from "./types";
import { DIAS_SEMANA, grupoDelDia } from "@/lib/planificacion/cuadrillas";
import { calcularReporteCapacidad, hhPorDia } from "@/lib/planificacion/capacidad";
import { fechaLarga } from "@/lib/planificacion/fechaSemana";
import { GRUPOS_ORDEN, grupoColor } from "@/lib/planificacion/personal";
import { tipoOtDisplay } from "@/lib/tiposOt";
import PersonalRail from "./PersonalRail";
import { useProgramacionDnd } from "./useProgramacionDnd";
import type { EditCuadrillaFn, EditHHDiaFn } from "./useProgramacionDnd";
import { colorUtilizacion, ResumenSemanal, CapacidadEditor, AsignarGrupoPopover } from "./ResumenCapacidad";
import type { EditCapacidadFn } from "./ResumenCapacidad";

const GRUPOS_EDITABLES = ["Diurno", "Nocturno", "G1", "G2", "G3", "G4"];
const COLS = [
  "No OT", "Tipo OT", "Tipo Trabajo", "Prioridad", "Descripción de Trabajo",
  "Equipo", "Descripción de Equipo", "Personas", "Hr Trabajo", "Hr Total", "Personal",
];

function etiquetaGrupo(grupo: string): string {
  if (grupo === "Diurno") return "TURNO DIURNO";
  if (grupo === "Nocturno") return "TURNO NOCTURNO";
  return `GRUPO ${grupo.replace(/^G/, "")}`;
}

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const td: React.CSSProperties = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid #f1f5f9" };

function OtEditFields({ ot, onSave, onCancel, onDelete }: {
  ot: OtBorrador;
  onSave: (patch: Partial<OtBorrador>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({ ...ot });

  function set<K extends keyof OtBorrador>(field: K, value: OtBorrador[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function guardar() {
    const dias = form.dias ?? [];
    onSave({
      grupo: form.grupo,
      personas: Number(form.personas),
      hrsTrabajo: Number(form.hrsTrabajo),
      fechaInicioOt: form.fechaInicioOt,
      fechaFinOt: form.fechaFinOt,
      dias,
      diasTexto: dias.join(", "),
    });
  }

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", marginBottom: 3 }}>Grupo</div>
        <select value={form.grupo} onChange={e => set("grupo", e.target.value)}
          style={{ padding: "5px 8px", borderRadius: 6, border: "1.5px solid #7c3aed", fontSize: 12 }}>
          {GRUPOS_EDITABLES.map(g => <option key={g}>{g}</option>)}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Personas</div>
        <input type="number" min={1} max={20} value={form.personas} onChange={e => set("personas", Number(e.target.value))}
          style={{ width: 60, padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Hrs/día</div>
        <input type="number" min={0} max={24} step={0.5} value={form.hrsTrabajo} onChange={e => set("hrsTrabajo", Number(e.target.value))}
          style={{ width: 60, padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Inicio</div>
        <input type="date" value={form.fechaInicioOt?.slice(0, 10) ?? ""} onChange={e => set("fechaInicioOt", e.target.value)}
          style={{ padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Fin</div>
        <input type="date" value={form.fechaFinOt?.slice(0, 10) ?? ""} onChange={e => set("fechaFinOt", e.target.value)}
          style={{ padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Días</div>
        <div style={{ display: "flex", gap: 3 }}>
          {DIAS_SEMANA.map(d => (
            <button key={d}
              onClick={() => {
                const prev = form.dias ?? [];
                set("dias", prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
              }}
              style={{
                width: 26, height: 26, borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer",
                border: "1.5px solid " + ((form.dias ?? []).includes(d) ? "#7c3aed" : "#e2e8f0"),
                background: (form.dias ?? []).includes(d) ? "#7c3aed" : "white",
                color: (form.dias ?? []).includes(d) ? "white" : "#374151",
              }}
            >{d}</button>
          ))}
        </div>
      </div>
      <div style={{ minWidth: 180 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Personal asignado</div>
        <div style={{
          width: "100%", minHeight: 40, borderRadius: 6, border: "1.5px solid #e2e8f0",
          fontSize: 11, padding: "6px 8px", color: "#475569", background: "#f8fafc",
        }}>
          {ot.personalAsignado.length > 0 ? ot.personalAsignado.join(", ") : <span style={{ color: "#cbd5e1" }}>Sin asignar</span>}
          <div style={{ marginTop: 4, fontSize: 10, color: "#94a3b8" }}>Arrastra personal desde el panel izquierdo sobre la fila de la OT para asignar, o usa la × de cada chip para quitar.</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
        <button onClick={guardar} style={{
          padding: "6px 14px", borderRadius: 6, border: "none", background: "#7c3aed",
          color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}>Guardar</button>
        <button onClick={onCancel} style={{
          padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
          background: "white", fontSize: 12, cursor: "pointer",
        }}>Cancelar</button>
        <button onClick={onDelete} style={{
          padding: "6px 10px", borderRadius: 6, border: "1px solid #fecaca",
          background: "#fff5f5", color: "#dc2626", fontSize: 12, cursor: "pointer",
        }}>Eliminar</button>
      </div>
    </div>
  );
}

function OtEditForm({ ot, onSave, onCancel, onDelete }: {
  ot: OtBorrador;
  onSave: (patch: Partial<OtBorrador>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <tr style={{ background: "#f8f7ff", borderBottom: "2px solid #7c3aed30" }}>
      <td colSpan={COLS.length} style={{ padding: "12px 8px" }}>
        <OtEditFields ot={ot} onSave={onSave} onCancel={onCancel} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function BacklogCard({ ot, disabled, editando, isDragging, onDragStart, onDragEnd, onDrop, onClick, onCancel, onSave, onDelete }: {
  ot: OtBorrador;
  disabled: boolean;
  editando: boolean;
  isDragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: DragEvent) => void;
  onClick: () => void;
  onCancel: () => void;
  onSave: (patch: Partial<OtBorrador>) => void;
  onDelete: () => void;
}) {
  const tipo = tipoOtDisplay(ot.tipoOT);

  if (editando) {
    return (
      <div style={{ background: "white", border: "1.5px solid #7c3aed", borderRadius: 8, padding: 8, marginBottom: 6 }}>
        <OtEditFields ot={ot} onSave={onSave} onCancel={onCancel} onDelete={onDelete} />
      </div>
    );
  }

  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
      onClick={onClick}
      title={disabled ? undefined : "Arrastra para programar · clic para editar · suelta personal aquí para asignar"}
      style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "7px 9px", marginBottom: 6, cursor: disabled ? "default" : "grab",
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: "#0f2847" }}>{ot.numeroOT}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 5px",
          background: tipo.color.bg, color: tipo.color.color,
        }}>{tipo.texto}</span>
      </div>
      {ot.tag && <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{ot.tag}</div>}
      <div style={{
        fontSize: 11, color: "#334155", marginBottom: 4, display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>{ot.descripcion}</div>
      <div style={{ fontSize: 10, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
        <span>{ot.grupo} · {ot.personas}p</span>
        <span style={{ fontWeight: 700 }}>{fmtNum(ot.hhTotal)}HH</span>
      </div>
    </div>
  );
}

function BacklogPanel({ ots, disabled, editando, setEditando, draggingOtId, onPatchOt, onDeleteOt, handleDragStartOt, setDraggingOtId, handleDropTecnicoEnOt, handleDropColumna }: {
  ots: OtBorrador[];
  disabled: boolean;
  editando: string | null;
  setEditando: (key: string | null) => void;
  draggingOtId: string | null;
  onPatchOt: (otId: string, patch: Partial<OtBorrador>) => void;
  onDeleteOt: (otId: string) => void;
  handleDragStartOt: (e: DragEvent, otId: string) => void;
  setDraggingOtId: (id: string | null) => void;
  handleDropTecnicoEnOt: (e: DragEvent, otId: string, diaCode: string) => void;
  handleDropColumna: (e: DragEvent, dia: string) => void;
}) {
  const ordenadas = [...ots].sort((a, b) => a.numeroOT.localeCompare(b.numeroOT, undefined, { numeric: true }));
  const hhTotal = ordenadas.reduce((s, o) => s + o.hhTotal, 0);

  return (
    <div
      style={{
        width: 224, flexShrink: 0, position: "sticky", top: 60, background: "#fafafa",
        border: "1.5px dashed #cbd5e1", borderRadius: 12, padding: 10,
      }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => handleDropColumna(e, "")}
    >
      <div style={{ fontWeight: 800, fontSize: 13, color: "#0f2847" }}>Sin programar</div>
      <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 4 }}>OTs importadas sin día</div>
      <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>
        {ordenadas.length} OTs · {fmtNum(hhTotal)}HH
      </div>
      <div style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 2 }}>
        {ordenadas.length === 0 ? (
          <p style={{ textAlign: "center", color: "#94a3b8", fontStyle: "italic", fontSize: 11.5, padding: "10px 0" }}>
            Sin OTs pendientes
          </p>
        ) : (
          ordenadas.map(ot => {
            const key = `${ot.id}::backlog`;
            return (
              <BacklogCard
                key={key}
                ot={ot}
                disabled={disabled}
                editando={editando === key}
                isDragging={draggingOtId === ot.id}
                onDragStart={e => handleDragStartOt(e, ot.id)}
                onDragEnd={() => setDraggingOtId(null)}
                onDrop={e => handleDropTecnicoEnOt(e, ot.id, "")}
                onClick={() => !disabled && setEditando(key)}
                onCancel={() => setEditando(null)}
                onSave={patch => { onPatchOt(ot.id, patch); setEditando(null); }}
                onDelete={() => { onDeleteOt(ot.id); setEditando(null); }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// Clic sobre la HH del día para editarla al vuelo — misma lógica que el
// click-to-edit de OtCard en el Tablero: en OTs multi-día fija un override
// puntual de ESE día (hhPorDiaManual), el resto se sigue repartiendo parejo.
function HHCell({ ot, dia, disabled, onEditarHH, onEditarHHDia }: {
  ot: OtBorrador; dia: string; disabled: boolean;
  onEditarHH: (otId: string, hhTotal: number) => void;
  onEditarHHDia: EditHHDiaFn;
}) {
  const multiDia = ot.dias.length > 1;
  const horasEsteDia = hhPorDia(ot, dia);
  const manualEsteDia = ot.hhPorDiaManual?.[dia] != null;
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(multiDia ? horasEsteDia : ot.hhTotal));

  function empezar() {
    setValor(String(multiDia ? horasEsteDia : ot.hhTotal));
    setEditando(true);
  }

  function guardar() {
    if (multiDia) {
      if (valor.trim() === "") {
        if (manualEsteDia) onEditarHHDia(ot.id, dia, null);
      } else {
        const n = Number(valor);
        if (Number.isFinite(n) && n >= 0 && n !== horasEsteDia) onEditarHHDia(ot.id, dia, n);
      }
    } else {
      const n = Number(valor);
      if (Number.isFinite(n) && n >= 0 && n !== ot.hhTotal) onEditarHH(ot.id, n);
    }
    setEditando(false);
  }

  if (editando) {
    return (
      <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
        <input
          type="number" min={0} step={0.5} autoFocus value={valor}
          onChange={e => setValor(e.target.value)}
          onBlur={guardar}
          onKeyDown={e => {
            if (e.key === "Enter") guardar();
            if (e.key === "Escape") { setValor(String(multiDia ? horasEsteDia : ot.hhTotal)); setEditando(false); }
          }}
          style={{ width: 56, fontSize: 12, fontWeight: 700, textAlign: "center", borderRadius: 4, border: "1.5px solid #7c3aed", padding: "2px 4px" }}
        />
      </td>
    );
  }

  return (
    <td
      style={{ ...td, textAlign: "center", fontWeight: 700, cursor: disabled ? "default" : "pointer" }}
      onClick={e => { if (disabled) return; e.stopPropagation(); empezar(); }}
      title={disabled ? undefined : multiDia ? `Total ${fmtNum(ot.hhTotal)}HH en ${ot.dias.length} días · clic para fijar este día a mano, vaciar y Enter para volver a automático` : "Clic para editar HH"}
    >
      {fmtNum(horasEsteDia)}{manualEsteDia ? " ✎" : ""}
    </td>
  );
}

function PersonalChips({ nombres, disabled, onQuitar }: {
  nombres: string[]; disabled: boolean; onQuitar: (nombre: string) => void;
}) {
  if (nombres.length === 0) return <span style={{ color: "#cbd5e1" }}>Sin asignar</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
      {nombres.map(nombre => (
        <span key={nombre} style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          background: "#ecfdf5", color: "#047857", borderRadius: 10,
          padding: "1px 5px 1px 7px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
        }}>
          {nombre}
          {!disabled && (
            <button
              onClick={e => { e.stopPropagation(); onQuitar(nombre); }}
              style={{ border: "none", background: "none", color: "#047857", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}
            >×</button>
          )}
        </span>
      ))}
    </div>
  );
}

export default function ListaPrograma({ plan, cuadrilla, onPatchOt, onDeleteOt, onEditCuadrilla, onEditCapacidad, disabled }: {
  plan: Plan;
  cuadrilla: CuadrillaMatriz;
  onPatchOt: (otId: string, patch: Partial<OtBorrador>) => void;
  onDeleteOt: (otId: string) => void;
  onEditCuadrilla: EditCuadrillaFn;
  onEditCapacidad: EditCapacidadFn;
  disabled: boolean;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [editandoCapacidad, setEditandoCapacidad] = useState<string | null>(null);
  const [asignandoGrupo, setAsignandoGrupo] = useState<string | null>(null);

  const ots = plan.ots.filter(o => o.seleccionada || o.esGuardia);
  const reporte = calcularReporteCapacidad(ots, cuadrilla, plan.capacidadOverride, DIAS_SEMANA);

  const {
    draggingOtId, setDraggingOtId, moverADia, editarHH, editarHHDia, quitarTecnico, asignarGrupoCompleto,
    handleDragStartOt, handleDropColumna, handleDropGrupo, handleDropTecnicoEnOt,
  } = useProgramacionDnd({ plan, cuadrilla, onPatchOt, onEditCuadrilla });

  if (ots.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
        Todavía no elegiste ninguna OT para esta semana. Ve a la pestaña &quot;Selección&quot; y marca las que se programarán.
      </div>
    );
  }

  const backlogOts = ots.filter(o => !o.dias || o.dias.length === 0);

  function filaOt(ot: OtBorrador, dia: string) {
    const key = `${ot.id}::${dia}`;
    if (editando === key) {
      return (
        <OtEditForm
          key={key}
          ot={ot}
          onCancel={() => setEditando(null)}
          onSave={patch => { onPatchOt(ot.id, patch); setEditando(null); }}
          onDelete={() => { onDeleteOt(ot.id); setEditando(null); }}
        />
      );
    }
    return (
      <tr
        key={key}
        draggable={!disabled}
        onDragStart={e => handleDragStartOt(e, ot.id)}
        onDragEnd={() => setDraggingOtId(null)}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { handleDropTecnicoEnOt(e, ot.id, dia); handleDropGrupo(e, dia, grupoDelDia(ot, dia)); }}
        onClick={() => !disabled && setEditando(key)}
        style={{ cursor: disabled ? "default" : "grab", opacity: draggingOtId === ot.id ? 0.4 : 1 }}
        title={disabled ? undefined : "Arrastra para mover · clic para editar · suelta personal aquí para asignar"}
      >
        <td style={{ ...td, fontWeight: 700, color: "#0f2847", whiteSpace: "nowrap" }}>
          {!disabled && (
            <button
              onClick={e => { e.stopPropagation(); moverADia(ot.id, ""); }}
              title="Devolver a Sin programar"
              style={{
                border: "none", background: "#f1f5f9", color: "#94a3b8", fontSize: 10, borderRadius: 4,
                width: 16, height: 16, lineHeight: "16px", cursor: "pointer", padding: 0, marginRight: 5,
              }}
            >↩</button>
          )}
          {ot.numeroOT}
        </td>
        <td style={td}>{ot.tipoOT}</td>
        <td style={td}>{ot.tipoTrabajo}</td>
        <td style={{ ...td, textAlign: "center" }}>{ot.prioridad ?? "—"}</td>
        <td style={td}>{ot.descripcion}</td>
        <td style={td}>{ot.tag}</td>
        <td style={td}>{ot.descripcionEquipo}</td>
        <td style={{ ...td, textAlign: "center" }}>{ot.personas}</td>
        <td style={{ ...td, textAlign: "center" }}>{fmtNum(ot.hrsTrabajo)}</td>
        <HHCell ot={ot} dia={dia} disabled={disabled} onEditarHH={editarHH} onEditarHHDia={editarHHDia} />
        <td style={{ ...td, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <PersonalChips
              nombres={ot.personalAsignado.filter(n => (cuadrilla[grupoDelDia(ot, dia)]?.[dia] ?? []).some(t => t.nombre === n))}
              disabled={disabled}
              onQuitar={nombre => quitarTecnico(ot.id, nombre, dia)}
            />
            {!disabled && (
              <button
                onClick={e => { e.stopPropagation(); setAsignandoGrupo(asignandoGrupo === key ? null : key); }}
                title={`Asignar todos los miembros de ${grupoDelDia(ot, dia)} a esta OT`}
                style={{ border: "none", background: "none", color: "#7c3aed", cursor: "pointer", fontSize: 10, fontWeight: 700, padding: 0, flexShrink: 0, whiteSpace: "nowrap" }}
              >+ Grupo</button>
            )}
          </div>
          {asignandoGrupo === key && (
            <AsignarGrupoPopover
              onClose={() => setAsignandoGrupo(null)}
              onElegir={alcance => asignarGrupoCompleto(ot.id, dia, alcance)}
            />
          )}
        </td>
      </tr>
    );
  }

  return (
    <div>
    <ResumenSemanal reporte={reporte} />
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <PersonalRail plan={plan} disabled={disabled} />
      <BacklogPanel
        ots={backlogOts}
        disabled={disabled}
        editando={editando}
        setEditando={setEditando}
        draggingOtId={draggingOtId}
        onPatchOt={onPatchOt}
        onDeleteOt={onDeleteOt}
        handleDragStartOt={handleDragStartOt}
        setDraggingOtId={setDraggingOtId}
        handleDropTecnicoEnOt={handleDropTecnicoEnOt}
        handleDropColumna={handleDropColumna}
      />
      <div style={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden", borderRadius: "0 12px 12px 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {DIAS_SEMANA.map(dia => {
            const diaResumen = reporte.porDia.find(d => d.dia === dia);
            const pct = diaResumen ? Math.round(diaResumen.utilizacion * 100) : 0;
            const ucDia = colorUtilizacion(diaResumen?.utilizacion ?? 0, diaResumen?.horasDisponibles ?? 0);
            const headcountTotal = GRUPOS_ORDEN.reduce((s, g) => {
              const cap = reporte.porGrupoDia.find(f => f.grupo === g && f.dia === dia);
              return s + (cap?.headcount ?? 0);
            }, 0);

            return (
              <Fragment key={dia}>
                <tr>
                  <td
                    colSpan={COLS.length}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDropColumna(e, dia)}
                    style={{ background: "#0f2847", color: "white", fontWeight: 800, fontSize: 13, padding: "8px 10px" }}
                  >
                    {fechaLarga(plan.semana, plan.anio, dia)}
                  </td>
                </tr>

                <tr style={{ background: "#f8fafc" }}>
                  {COLS.map(h => (
                    <th key={h} style={{ padding: "7px 8px", fontSize: 11, fontWeight: 700, color: "#64748b", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>

                {GRUPOS_ORDEN.map(g => {
                  const cap = reporte.porGrupoDia.find(f => f.grupo === g && f.dia === dia);
                  const otsBlock = ots
                    .filter(o => o.dias.includes(dia) && grupoDelDia(o, dia) === g)
                    .sort((a, b) => a.numeroOT.localeCompare(b.numeroOT, undefined, { numeric: true }));
                  const colores = grupoColor(g);
                  const horasDisponibles = cap?.horasDisponibles ?? 0;
                  const utilPct = cap ? Math.round(cap.utilizacion * 100) : 0;
                  const capKey = `${dia}::${g}`;
                  const ucGrupo = colorUtilizacion(cap?.utilizacion ?? 0, horasDisponibles);

                  return (
                    <Fragment key={g}>
                      <tr onDragOver={e => e.preventDefault()} onDrop={e => handleDropGrupo(e, dia, g)}>
                        <td colSpan={COLS.length} style={{ background: colores.bg, color: colores.color, fontWeight: 800, fontSize: 12, padding: "5px 8px" }}>
                          {etiquetaGrupo(g)}
                        </td>
                      </tr>
                      <tr style={{ background: "#fdf1e7", fontWeight: 700, fontSize: 11.5 }}
                        onDragOver={e => e.preventDefault()} onDrop={e => handleDropGrupo(e, dia, g)}
                      >
                        <td colSpan={7} style={td}></td>
                        <td style={{ ...td, textAlign: "center" }}>{cap?.headcount ?? 0}</td>
                        <td style={{ ...td, textAlign: "center" }}>{fmtNum(horasDisponibles)}</td>
                        <td style={{ ...td, textAlign: "center", position: "relative" }}>
                          <span
                            onClick={() => !disabled && setEditandoCapacidad(editandoCapacidad === capKey ? null : capKey)}
                            title={disabled ? undefined : `Ajustar HH disponibles de ${g} · ${fechaLarga(plan.semana, plan.anio, dia)}`}
                            style={{
                              display: "inline-block", background: ucGrupo.bg, color: ucGrupo.color, borderRadius: 6,
                              padding: "2px 8px", fontWeight: 800, cursor: disabled ? "default" : "pointer",
                            }}
                          >{utilPct}%{cap?.esManual ? " ✎" : ""}</span>
                          {editandoCapacidad === capKey && cap && (
                            <CapacidadEditor
                              grupo={g} dia={dia}
                              headcount={cap.headcount} horasAuto={cap.headcount * 10}
                              horasActual={cap.horasDisponibles} esManual={cap.esManual}
                              disabled={disabled}
                              onClose={() => setEditandoCapacidad(null)}
                              onEdit={onEditCapacidad}
                            />
                          )}
                        </td>
                        <td style={td}>{fmtNum(horasDisponibles)} Hrs {etiquetaGrupo(g)}</td>
                      </tr>

                      {otsBlock.length === 0 ? (
                        <tr onDragOver={e => e.preventDefault()} onDrop={e => handleDropGrupo(e, dia, g)}>
                          <td colSpan={COLS.length} style={{ padding: "10px 8px", textAlign: "center", color: "#94a3b8", fontStyle: "italic", fontSize: 12 }}>
                            Sin OTs asignadas — arrastra una OT aquí
                          </td>
                        </tr>
                      ) : otsBlock.map(ot => filaOt(ot, dia))}
                    </Fragment>
                  );
                })}

                <tr style={{ background: "#0f2847", color: "white", fontWeight: 800 }}>
                  <td colSpan={7} style={{ padding: "7px 8px" }}>UTILIZACIÓN</td>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>{headcountTotal}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>{fmtNum(diaResumen?.horasDisponibles ?? 0)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>{fmtNum(diaResumen?.horasProgramadas ?? 0)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>
                    <span style={{ display: "inline-block", background: ucDia.bg, color: ucDia.color, borderRadius: 6, padding: "2px 8px", fontWeight: 800 }}>{pct}%</span>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
    </div>
  );
}
