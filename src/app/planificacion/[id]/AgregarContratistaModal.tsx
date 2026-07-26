"use client";

import { useEffect, useRef, useState } from "react";

type UsuarioContratista = {
  _id: string;
  nombreCompleto: string;
  disciplina: string;
};

type Props = {
  planId: string;
  areaCodigo: string;
  rosterUsuarioIds: (string | null)[];
  onClose: () => void;
  onAgregado: () => void;
};

// Modal para agregar contratistas (Usuario con esContratista=true) al roster
// de la semana en curso. Su asistencia queda fija en "T" los 7 días — a
// diferencia del personal de planta (que entra por Excel con turnos reales),
// un contratista se considera disponible toda la semana desde que se agrega
// aquí. Ver POST /api/planificacion/[id]/roster.
export default function AgregarContratistaModal({ planId, areaCodigo, rosterUsuarioIds, onClose, onAgregado }: Props) {
  const [usuarios, setUsuarios] = useState<UsuarioContratista[]>([]);
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/usuarios?area=${areaCodigo}&contratista=true`)
      .then(r => r.json())
      .then((data: UsuarioContratista[]) => setUsuarios(data))
      .catch(() => setError("No se pudo cargar la lista de contratistas"))
      .finally(() => setCargando(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [areaCodigo]);

  const disponibles = usuarios.filter(u => !rosterUsuarioIds.includes(u._id));
  const filtrados = disponibles.filter(u =>
    u.nombreCompleto.toLowerCase().includes(busqueda.toLowerCase())
  );

  function toggle(id: string) {
    setSeleccionados(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    for (const usuarioId of seleccionados) {
      const res = await fetch(`/api/planificacion/${planId}/roster`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Error agregando contratista");
        setGuardando(false);
        return;
      }
    }
    setGuardando(false);
    onAgregado();
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,40,71,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "white", borderRadius: 14, padding: 24, width: "100%", maxWidth: 420,
        boxShadow: "0 8px 32px rgba(15,40,71,0.18)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#0f2847" }}>
              Agregar contratista
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              Disponible todos los días de la semana (T)
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 14, color: "#64748b" }}>✕</button>
        </div>

        <input
          ref={inputRef}
          placeholder="Buscar contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, boxSizing: "border-box" as const, marginBottom: 10 }}
        />

        {seleccionados.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {seleccionados.map(id => {
              const u = usuarios.find(x => x._id === id);
              if (!u) return null;
              return (
                <span key={id} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "#dbeafe", color: "#1d4ed8", borderRadius: 20,
                  padding: "3px 10px", fontSize: 12, fontWeight: 600,
                }}>
                  👤 {u.nombreCompleto}
                  <button onClick={() => toggle(id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#1d4ed8", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              );
            })}
          </div>
        )}

        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          {filtrados.length === 0 && (
            <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 16 }}>
              {cargando ? "Cargando contratistas..." : disponibles.length === 0
                ? "No hay contratistas para esta área. Créalos en Configuración → Usuarios."
                : "Sin resultados"}
            </p>
          )}
          {filtrados.map(u => {
            const sel = seleccionados.includes(u._id);
            return (
              <button key={u._id} onClick={() => toggle(u._id)} style={{
                width: "100%", textAlign: "left", padding: "10px 14px",
                border: "none", borderBottom: "1px solid #f8fafc",
                background: sel ? "#eff6ff" : "white", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 4, border: `2px solid ${sel ? "#2563eb" : "#cbd5e1"}`,
                  background: sel ? "#2563eb" : "white", display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {sel && <span style={{ color: "white", fontSize: 11, fontWeight: 800 }}>✓</span>}
                </span>
                <span style={{ fontSize: 13, fontWeight: sel ? 700 : 400, color: sel ? "#1d4ed8" : "#1e293b" }}>
                  {u.nombreCompleto}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: "#94a3b8" }}>{u.disciplina}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <p style={{ marginTop: 10, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0",
            background: "white", color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando || seleccionados.length === 0}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: seleccionados.length === 0 ? "#e2e8f0" : "#0891b2",
              color: seleccionados.length === 0 ? "#94a3b8" : "white",
              fontSize: 13, fontWeight: 700, cursor: seleccionados.length === 0 ? "not-allowed" : "pointer",
            }}
          >{guardando ? "Agregando…" : `Agregar (${seleccionados.length})`}</button>
        </div>
      </div>
    </div>
  );
}
