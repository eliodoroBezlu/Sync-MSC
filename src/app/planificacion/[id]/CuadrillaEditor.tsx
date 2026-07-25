"use client";

import { useState } from "react";
import type { RosterItem, TecnicoRef } from "./types";
import { diasDesde } from "@/lib/planificacion/cuadrillas";

type EditFn = (
  grupo: string,
  dias: string[],
  agregar?: { nombre: string; usuarioId?: string | null }[],
  quitar?: string[],
) => void;

// Popover de administración de cuadrilla: quién cubre `grupo` el día `dia`.
// Independiente de cualquier OT puntual — es el editor de la fuente de
// verdad (CuadrillaMiembro), con opción de aplicar el cambio "desde este
// día en adelante" para resolver swaps de mitad de semana sin tocar los
// días ya pasados ni el resto de las OTs.
export default function CuadrillaEditor({
  grupo, dia, miembros, roster, disabled, onClose, onEdit,
}: {
  grupo: string;
  dia: string;
  miembros: TecnicoRef[];
  roster: RosterItem[];
  disabled: boolean;
  onClose: () => void;
  onEdit: EditFn;
}) {
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [desdeAqui, setDesdeAqui] = useState(false);

  const nombresEnCrew = new Set(miembros.map(m => m.nombre));
  const candidatos = roster.filter(r => !nombresEnCrew.has(r.nombre));

  function diasAplicables(): string[] {
    return desdeAqui ? diasDesde(dia) : [dia];
  }

  function agregar() {
    if (!nombreNuevo) return;
    const r = roster.find(x => x.nombre === nombreNuevo);
    onEdit(grupo, diasAplicables(), [{ nombre: nombreNuevo, usuarioId: r?.usuarioId ?? null }]);
    setNombreNuevo("");
  }

  function quitar(nombre: string) {
    onEdit(grupo, diasAplicables(), undefined, [nombre]);
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", zIndex: 30, top: "100%", left: 0, marginTop: 4,
        width: 220, background: "white", borderRadius: 10, border: "1px solid #e2e8f0",
        boxShadow: "0 8px 24px rgba(15,40,71,0.18)", padding: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#374151" }}>{grupo} · {dia}</span>
        <button
          onClick={onClose}
          style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
        >×</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto", marginBottom: 8 }}>
        {miembros.length === 0 && (
          <span style={{ fontSize: 10, color: "#cbd5e1", fontStyle: "italic" }}>Sin nadie en la cuadrilla</span>
        )}
        {miembros.map(m => (
          <div key={m.nombre} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#374151" }}>
            <span>{m.nombre}</span>
            {!disabled && (
              <button
                onClick={() => quitar(m.nombre)}
                style={{ border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontSize: 10, fontWeight: 700, padding: 0 }}
              >Quitar</button>
            )}
          </div>
        ))}
      </div>

      {!disabled && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            <select
              value={nombreNuevo}
              onChange={e => setNombreNuevo(e.target.value)}
              style={{ flex: 1, fontSize: 10, borderRadius: 6, border: "1px solid #e2e8f0", padding: "3px 4px", minWidth: 0 }}
            >
              <option value="">Agregar técnico…</option>
              {candidatos.map(r => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
            </select>
            <button
              onClick={agregar}
              disabled={!nombreNuevo}
              style={{
                padding: "3px 10px", borderRadius: 6, border: "none", background: "#7c3aed",
                color: "white", fontSize: 12, fontWeight: 700, cursor: nombreNuevo ? "pointer" : "default",
                opacity: nombreNuevo ? 1 : 0.5, flexShrink: 0,
              }}
            >+</button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#64748b", cursor: "pointer" }}>
            <input type="checkbox" checked={desdeAqui} onChange={e => setDesdeAqui(e.target.checked)} />
            Aplicar desde {dia} en adelante
          </label>
        </>
      )}
    </div>
  );
}
