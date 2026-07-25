"use client";

import { useState } from "react";
import type { OtBorrador, Plan } from "./types";

const TIPO_STYLE: Record<string, { bg: string; color: string }> = {
  C: { bg: "#fee2e2", color: "#dc2626" },
  P: { bg: "#dbeafe", color: "#1d4ed8" },
  T: { bg: "#ede9fe", color: "#7c3aed" },
};
function tipoStyle(t: string) {
  return TIPO_STYLE[t] ?? { bg: "#f1f5f9", color: "#475569" };
}

function MotivoForm({ ot, onPatch }: {
  ot: OtBorrador;
  onPatch: (otId: string, patch: Partial<OtBorrador>) => void;
}) {
  const [motivo, setMotivo] = useState(ot.motivoNoProgramada ?? "");
  const [comentario, setComentario] = useState(ot.comentarioNoProgramada ?? "");

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, borderTop: "1px solid #fee2e2", paddingTop: 8 }}>
      <input
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
        onBlur={() => onPatch(ot.id, { motivoNoProgramada: motivo || null })}
        placeholder="Motivo (ej: falta material, OR-1234)"
        style={{
          flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #fecaca",
          fontSize: 11, color: "#374151",
        }}
      />
      <input
        value={comentario}
        onChange={e => setComentario(e.target.value)}
        onBlur={() => onPatch(ot.id, { comentarioNoProgramada: comentario || null })}
        placeholder="Comentario"
        style={{
          flex: 1, padding: "5px 8px", borderRadius: 6, border: "1.5px solid #fecaca",
          fontSize: 11, color: "#374151",
        }}
      />
    </div>
  );
}

function SeleccionCard({ ot, onToggle, onPatch }: {
  ot: OtBorrador;
  onToggle: (ot: OtBorrador) => void;
  onPatch: (otId: string, patch: Partial<OtBorrador>) => void;
}) {
  const s = tipoStyle(ot.tipoOT);
  const bloqueada = ot.esGuardia;
  return (
    <div style={{
      background: "white", borderRadius: 10,
      border: `1.5px solid ${ot.seleccionada ? "#16a34a40" : "#e2e8f0"}`,
      padding: 10, boxShadow: "0 1px 3px rgba(15,40,71,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <button
          onClick={() => !bloqueada && onToggle(ot)}
          disabled={bloqueada}
          title={bloqueada ? "OPEPLANT: siempre programada" : ot.seleccionada ? "Clic para quitar de esta semana" : "Clic para elegir esta semana"}
          style={{
            width: 24, height: 24, borderRadius: 6, flexShrink: 0, marginTop: 1,
            border: `1.5px solid ${ot.seleccionada ? "#16a34a" : "#cbd5e1"}`,
            background: ot.seleccionada ? "#16a34a" : "white",
            color: "white", fontSize: 13, fontWeight: 900, lineHeight: "20px",
            cursor: bloqueada ? "default" : "pointer",
          }}
        >{ot.seleccionada ? "✓" : ""}</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: "#0f2847" }}>{ot.numeroOT}</span>
            <span style={{ background: s.bg, color: s.color, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>{ot.tipoOT}</span>
            {bloqueada && (
              <span style={{ background: "#1e1b4b", color: "white", padding: "1px 8px", borderRadius: 10, fontSize: 9, fontWeight: 700 }}>🛡️ OPEPLANT · toda la semana</span>
            )}
            {ot.esBacklog && !bloqueada && (
              <span style={{ background: "#fef3c7", color: "#92400e", padding: "1px 8px", borderRadius: 10, fontSize: 9, fontWeight: 700 }}>↺ Backlog semana anterior</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#374151", marginTop: 3 }}>{ot.descripcion}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 10, color: "#94a3b8" }}>
            <span>{ot.tag}</span>
            <span>{ot.personas}px × {ot.hrsTrabajo}h = <strong style={{ color: "#374151" }}>{ot.hhTotal}HH</strong></span>
            {ot.solicitante && <span>Solicita: {ot.solicitante}</span>}
          </div>

          {!ot.seleccionada && !bloqueada && <MotivoForm ot={ot} onPatch={onPatch} />}
        </div>
      </div>
    </div>
  );
}

export default function SeleccionOts({ plan, onPatchOt, disabled }: {
  plan: Plan;
  onPatchOt: (otId: string, patch: Partial<OtBorrador>) => void;
  disabled: boolean;
}) {
  function toggle(ot: OtBorrador) {
    if (disabled) return;
    onPatchOt(ot.id, {
      seleccionada: !ot.seleccionada,
      ...(!ot.seleccionada ? { motivoNoProgramada: null, comentarioNoProgramada: null } : {}),
    });
  }

  function seleccionarTodas(valor: boolean) {
    if (disabled) return;
    for (const ot of plan.ots) {
      if (ot.esGuardia) continue;
      if (ot.seleccionada !== valor) onPatchOt(ot.id, { seleccionada: valor });
    }
  }

  const seleccionables = plan.ots.filter(o => !o.esGuardia);
  const seleccionadas = plan.ots.filter(o => o.seleccionada);
  const hhSeleccionadas = seleccionadas.reduce((s, o) => s + o.hhTotal, 0);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 4px 14px", flexWrap: "wrap", gap: 10,
      }}>
        <div style={{ fontSize: 13, color: "#374151" }}>
          <strong style={{ color: "#16a34a", fontSize: 15 }}>{seleccionadas.length}</strong> de {plan.ots.length} OTs elegidas para esta semana · <strong>{hhSeleccionadas.toFixed(0)}HH</strong>
        </div>
        {!disabled && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => seleccionarTodas(true)} style={{
              padding: "6px 12px", borderRadius: 8, border: "1.5px solid #16a34a",
              background: "white", color: "#16a34a", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>Seleccionar todas ({seleccionables.length})</button>
            <button onClick={() => seleccionarTodas(false)} style={{
              padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0",
              background: "white", color: "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>Deseleccionar todas</button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plan.ots.map(ot => (
          <SeleccionCard key={ot.id} ot={ot} onToggle={toggle} onPatch={onPatchOt} />
        ))}
      </div>
    </div>
  );
}
