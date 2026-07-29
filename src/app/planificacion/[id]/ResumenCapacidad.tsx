"use client";

import { useState } from "react";
import type { calcularReporteCapacidad } from "@/lib/planificacion/capacidad";
import { grupoColor } from "@/lib/planificacion/personal";
import type { AlcanceGrupo } from "./useProgramacionDnd";

// Compartido entre Tablero y Lista: mismo cálculo de HH por grupo/día
// (calcularReporteCapacidad), mismo color de utilización y mismo editor de
// capacidad manual — para que ambas vistas muestren siempre los mismos
// números y permitan el mismo ajuste puntual (ej. alguien avisó que hoy solo
// vienen 3 de 4 en un grupo).

export type EditCapacidadFn = (grupo: string, dia: string, horas: number | null) => void;

export function colorUtilizacion(pct: number, disponible: number): { bg: string; color: string } {
  if (disponible <= 0) return { bg: "#f1f5f9", color: "#94a3b8" };
  if (pct > 1) return { bg: "#fee2e2", color: "#dc2626" };
  if (pct >= 0.85) return { bg: "#fef3c7", color: "#b45309" };
  return { bg: "#dcfce7", color: "#15803d" };
}

// Popover para ajustar manualmente las horas-hombre disponibles de un grupo
// en un día puntual (ej. alguien avisó que hoy solo vienen 3 de 4). Sin
// ajuste, la capacidad sale automática: headcount de la cuadrilla × 10h.
export function CapacidadEditor({
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

// Popover con las 3 opciones de alcance para "Asignar grupo completo": vuelca
// de una vez a todos los miembros vigentes de la cuadrilla del grupo efectivo
// de cada día objetivo, en vez de arrastrar técnico por técnico.
export function AsignarGrupoPopover({ onClose, onElegir }: { onClose: () => void; onElegir: (alcance: AlcanceGrupo) => void }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", zIndex: 30, top: "100%", right: 0, marginTop: 4,
        width: 168, background: "white", borderRadius: 10, border: "1px solid #e2e8f0",
        boxShadow: "0 8px 24px rgba(15,40,71,0.18)", padding: 6,
        display: "flex", flexDirection: "column", gap: 3,
      }}
    >
      {([
        ["dia", "Solo este día"],
        ["media", "Desde aquí (media semana)"],
        ["semana", "Toda la semana"],
      ] as [AlcanceGrupo, string][]).map(([alcance, label]) => (
        <button
          key={alcance}
          onClick={() => { onElegir(alcance); onClose(); }}
          style={{
            textAlign: "left", border: "none", background: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 600, color: "#374151", padding: "5px 6px", borderRadius: 6,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
        >{label}</button>
      ))}
    </div>
  );
}

// Resumen semanal de HH — réplica de las filas 1-8 de la hoja I-XX del Excel
// de referencia: disponible/programada/atención reactiva/utilización de la
// semana completa, más el % de utilización promedio de cada grupo.
export function ResumenSemanal({ reporte }: { reporte: ReturnType<typeof calcularReporteCapacidad> }) {
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
