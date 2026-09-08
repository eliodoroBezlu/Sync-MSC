"use client";

import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Panel "Pegar comentarios del JDE" dentro del paso 2 de Registro de OT.
//
// El JDE emite OTs (típicamente CMP y PDM) cuyo encabezado nombra un solo
// equipo, pero en los comentarios lista varios instrumentos más, cada uno con
// su TAG. El técnico solo tiene un campo TAG, así que esa información se pierde.
//
// Este panel deja pegar el bloque de comentarios del JDE, detecta los TAG por
// patrón, los valida contra la base de equipos (los mismos que busca el
// TagSearch de CMR/CMP) y ofrece agregarlos como equipos pendientes de llenar.
// No crea líneas: cada TAG elegido se llena con el MISMO editor y su propio
// Detalle del trabajo → Estado final del equipo.
// ─────────────────────────────────────────────────────────────────────────────

export type EquipoBusqueda = {
  tag: string;
  descripcion: string;
  tipoEquipo: string;
  descripcionTipo?: string;
  categoriaISO?: string | null;
  areaCodigo: string;
  descripcionArea?: string;
  nivel?: number;
  criticidad?: string;
};

// TAG de instrumento/equipo: 2–4 letras + 3–7 dígitos + sufijo corto opcional
// (ej. PIT270021, NIT230061D1, PIT-270021). Se admite separador y luego se
// normaliza quitándolo.
const RE_TAG = /\b[A-Z]{2,4}[-\s.]?\d{3,7}[A-Z0-9]{0,5}\b/g;
const MAX_CANDIDATOS = 25;

function normTag(t: string): string {
  return t.replace(/[-\s.]/g, "").toUpperCase();
}

const S = {
  wrap: {
    border: "1px dashed #93c5fd",
    borderRadius: 10,
    background: "#f8fbff",
    padding: "12px 14px",
    marginBottom: 12,
  } as React.CSSProperties,
  toggle: {
    background: "none",
    border: "none",
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "9px 11px",
    fontSize: 13,
    color: "#1e293b",
    outline: "none",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 78,
    background: "white",
  } as React.CSSProperties,
  btnPrimary: (disabled = false) =>
    ({
      background: disabled ? "#93c5fd" : "#2563eb",
      color: "white",
      border: "none",
      borderRadius: 8,
      padding: "8px 14px",
      fontSize: 13,
      fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
    }) as React.CSSProperties,
  btnGhost: {
    background: "white",
    color: "#64748b",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
  } as React.CSSProperties,
  fila: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 9px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "white",
    marginBottom: 5,
  } as React.CSSProperties,
};

export default function ImportarTagsJde({
  tagsExistentes,
  onAgregar,
}: {
  /** TAG ya cargados (líneas confirmadas + pendientes) para no duplicar. */
  tagsExistentes: string[];
  onAgregar: (equipos: EquipoBusqueda[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [encontrados, setEncontrados] = useState<EquipoBusqueda[]>([]);
  const [noEncontrados, setNoEncontrados] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [huboBusqueda, setHuboBusqueda] = useState(false);

  async function detectar() {
    const yaCargados = new Set(tagsExistentes.map(normTag));
    const brutos = (texto.toUpperCase().match(RE_TAG) ?? []).map(normTag);
    const candidatos = Array.from(new Set(brutos)).filter((t) => !yaCargados.has(t));

    setHuboBusqueda(true);
    if (candidatos.length === 0) {
      setEncontrados([]);
      setNoEncontrados([]);
      setSel(new Set());
      return;
    }

    setBuscando(true);
    try {
      const resultados = await Promise.all(
        candidatos.slice(0, MAX_CANDIDATOS).map(async (tag) => {
          try {
            const r = await fetch(`/api/equipos?tag=${encodeURIComponent(tag)}`);
            const d = (await r.json()) as EquipoBusqueda[];
            return { tag, eq: d[0] ?? null };
          } catch {
            return { tag, eq: null };
          }
        }),
      );
      const enc = resultados
        .map((x) => x.eq)
        .filter((eq): eq is EquipoBusqueda => !!eq);
      setEncontrados(enc);
      setNoEncontrados(resultados.filter((x) => !x.eq).map((x) => x.tag));
      setSel(new Set(enc.map((e) => e.tag.toUpperCase())));
    } finally {
      setBuscando(false);
    }
  }

  function toggle(tag: string) {
    setSel((prev) => {
      const next = new Set(prev);
      const k = tag.toUpperCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function confirmar() {
    const elegidos = encontrados.filter((e) => sel.has(e.tag.toUpperCase()));
    if (elegidos.length === 0) return;
    onAgregar(elegidos);
    setTexto("");
    setEncontrados([]);
    setNoEncontrados([]);
    setSel(new Set());
    setHuboBusqueda(false);
    setAbierto(false);
  }

  if (!abierto) {
    return (
      <div style={S.wrap}>
        <button type="button" style={S.toggle} onClick={() => setAbierto(true)}>
          <span style={{ fontSize: 15 }}>📋</span>
          Pegar comentarios del JDE para extraer TAGs
        </button>
      </div>
    );
  }

  const nSel = sel.size;

  return (
    <div style={S.wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f2847" }}>
          Extraer TAGs de los comentarios del JDE
        </span>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14 }}
        >
          ✕
        </button>
      </div>

      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
        Pegá el bloque de comentarios de la OT (con la lista de instrumentos). Se detectan los TAG
        y se validan contra la base de equipos; los que existan se agregan como equipos a llenar,
        cada uno con su propio Detalle del trabajo y Estado final.
      </p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Pegar aquí los comentarios del JDE…"
        style={S.textarea}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: encontrados.length || noEncontrados.length ? 12 : 0 }}>
        <button
          type="button"
          onClick={detectar}
          disabled={buscando || !texto.trim()}
          style={S.btnPrimary(buscando || !texto.trim())}
        >
          {buscando ? "Buscando…" : "Detectar TAGs"}
        </button>
        {texto && (
          <button type="button" onClick={() => setTexto("")} style={S.btnGhost}>
            Limpiar
          </button>
        )}
      </div>

      {huboBusqueda && !buscando && encontrados.length === 0 && noEncontrados.length === 0 && (
        <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 8 }}>
          No se detectaron TAGs nuevos en el texto.
        </p>
      )}

      {encontrados.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", marginBottom: 6 }}>
            En la base ({encontrados.length}) — marcá los que correspondan a esta OT
          </div>
          {encontrados.map((eq) => (
            <label key={eq.tag} style={{ ...S.fila, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={sel.has(eq.tag.toUpperCase())}
                onChange={() => toggle(eq.tag)}
                style={{ width: 16, height: 16, accentColor: "#2563eb", flexShrink: 0 }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{eq.tag}</span>
                <span style={{ fontSize: 12, color: "#64748b" }}> · {eq.descripcion}</span>
              </span>
              {eq.criticidad && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#64748b",
                    border: "1px solid #e2e8f0",
                    borderRadius: 4,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  Crit. {eq.criticidad}
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      {noEncontrados.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>
            No están en la base ({noEncontrados.length}) — cargalos con el buscador de TAG si aplica
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {noEncontrados.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 12,
                  color: "#b91c1c",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {encontrados.length > 0 && (
        <button
          type="button"
          onClick={confirmar}
          disabled={nSel === 0}
          style={S.btnPrimary(nSel === 0)}
        >
          Agregar {nSel} equipo{nSel === 1 ? "" : "s"} a llenar
        </button>
      )}
    </div>
  );
}
