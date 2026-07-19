"use client";

import { useState, useEffect } from "react";

const S = {
  card: { background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 16px", marginBottom: 12 },
  input: { width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "#1e293b", outline: "none", boxSizing: "border-box" as const, background: "white" },
  btnPrimary: (disabled = false) => ({ background: disabled ? "#93c5fd" : "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" as const : "pointer" as const }),
  btnGhost: { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" as const },
  err: { color: "#dc2626", fontSize: 12, marginTop: 4 },
};

export type Tecnico = { usuarioId: string; nombreCompleto: string };

export default function TecnicosPanel({
  areaCodigo, tecnicos, personalAsignadoPlan = [], onChange, error,
}: {
  areaCodigo: string;
  tecnicos: Tecnico[];
  personalAsignadoPlan?: string[];
  onChange: (t: Tecnico[]) => void;
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
