"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Panel de OTs de Parada de Planta dentro de "Registro de OT".
//
// Es 100% aditivo: no toca el plan semanal ni su maquinaria. Consulta
// GET /api/paradas/activa para saber si hay una parada en ejecución cuyo rango
// cubre la fecha del turno; si la hay, muestra al técnico logueado SÓLO las OTs
// de esa parada que le fueron asignadas (personalAsignadoIds). El técnico las
// abre y cierra desde aquí usando el avance diario de la parada
// (POST /api/paradas/[id]/avances), sin crear OrdenTrabajo.
// ─────────────────────────────────────────────────────────────────────────────

interface OtParada {
  id: string;
  numeroOT: string;
  tag: string;
  descripcion: string;
  disciplina: string;
  grupo: string;
  fase: "preparativos" | "ejecucion";
  estado: string;
  avancePct: number;
  personalAsignado: string[];
  personalAsignadoIds: string[];
}

interface AvanceHoy {
  paradaOtId: string;
  turno: "Dia" | "Noche";
  avancePct: number;
  hhPropias: number;
  hhApoyo: number;
  estado: string;
  comentario: string | null;
}

interface ParadaActiva {
  id: string;
  codigo: string;
  nombre: string;
  fechaEjecucionInicio: string;
  fechaEjecucionFin: string;
  ots: OtParada[];
  avancesHoy: AvanceHoy[];
}

interface Props {
  user: { id: string; nombre: string; rol: number } | null;
  /** Fecha del turno activo, formato YYYY-MM-DD (shiftFecha de la página). */
  fecha: string;
  /** Turno activo de la página (shiftTurno). */
  turno: "Diurno" | "Nocturno";
}

const ESTADO_META: Record<string, { label: string; color: string; bg: string }> = {
  no_iniciada: { label: "No iniciada", color: "#64748b", bg: "#f1f5f9" },
  en_ejecucion: { label: "En ejecución", color: "#0369a1", bg: "#e0f2fe" },
  terminada: { label: "Terminada", color: "#15803d", bg: "#dcfce7" },
  con_retraso: { label: "Con retraso", color: "#b91c1c", bg: "#fee2e2" },
};

const box: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  border: "1px solid #fed7aa",
  padding: 0,
  overflow: "hidden",
  marginBottom: 12,
};
const inp: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: "#1e293b",
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
  background: "white",
};
const btnBase: React.CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

function quitarAcentos(s: string): string {
  // Descompone y elimina marcas combinantes (U+0300–U+036F) sin regex literal.
  const desc = s.normalize("NFD");
  let out = "";
  for (const ch of desc) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x300 && c <= 0x36f) continue;
    out += ch;
  }
  return out;
}

function nombreCoincide(a: string, b: string): boolean {
  const norm = (s: string) => quitarAcentos(s.trim().toLowerCase()).replace(/\s+/g, " ");
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(" ").filter(Boolean);
  const pb = nb.split(" ").filter(Boolean);
  // Coincidencia por tokens en cualquier orden: al menos 2 palabras compartidas.
  const compartidas = pa.filter((t) => pb.includes(t)).length;
  return compartidas >= 2;
}

export default function PanelParadaOts({ user, fecha, turno }: Props) {
  const [parada, setParada] = useState<ParadaActiva | null>(null);
  const [cargando, setCargando] = useState(true);
  const turnoParada: "Dia" | "Noche" = turno === "Nocturno" ? "Noche" : "Dia";

  const recargar = useCallback(async () => {
    if (!fecha) return;
    try {
      const res = await fetch(`/api/paradas/activa?fecha=${encodeURIComponent(fecha)}`);
      const data = await res.json();
      if (data?.ok && data.parada) setParada(data.parada as ParadaActiva);
      else setParada(null);
    } catch {
      setParada(null);
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const misOts = useMemo(() => {
    if (!parada || !user) return [];
    return parada.ots.filter(
      (ot) =>
        ot.fase === "ejecucion" &&
        (ot.personalAsignadoIds.includes(user.id) ||
          ot.personalAsignado.some((n) => nombreCoincide(n, user.nombre))),
    );
  }, [parada, user]);

  const avancePorOt = useMemo(() => {
    const m = new Map<string, AvanceHoy>();
    if (parada) {
      for (const a of parada.avancesHoy) {
        if (a.turno === turnoParada) m.set(a.paradaOtId, a);
      }
    }
    return m;
  }, [parada, turnoParada]);

  if (cargando || !parada || !user || misOts.length === 0) return null;

  return (
    <div style={box}>
      <div style={{ padding: "14px 16px 10px", background: "#fff7ed", borderBottom: "1px solid #fed7aa" }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#c2410c" }}>{parada.codigo}</div>
        <div style={{ fontSize: 12, color: "#9a3412", marginTop: 2 }}>
          {parada.nombre} · turno {turnoParada === "Noche" ? "Noche" : "Día"} · {misOts.length} OT asignada
          {misOts.length === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {misOts.map((ot) => (
          <FilaOtParada
            key={ot.id}
            paradaId={parada.id}
            ot={ot}
            avanceHoy={avancePorOt.get(ot.id) ?? null}
            fecha={fecha}
            turnoParada={turnoParada}
            registradoPor={user.nombre}
            onCambio={recargar}
          />
        ))}
      </div>
    </div>
  );
}

function FilaOtParada({
  paradaId, ot, avanceHoy, fecha, turnoParada, registradoPor, onCambio,
}: {
  paradaId: string;
  ot: OtParada;
  avanceHoy: AvanceHoy | null;
  fecha: string;
  turnoParada: "Dia" | "Noche";
  registradoPor: string;
  onCambio: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({
    hhPropias: avanceHoy ? String(avanceHoy.hhPropias) : "",
    hhApoyo: avanceHoy ? String(avanceHoy.hhApoyo) : "",
    avancePct: String(avanceHoy?.avancePct ?? ot.avancePct ?? 0),
    comentario: avanceHoy?.comentario ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const meta = ESTADO_META[ot.estado] ?? ESTADO_META.no_iniciada;
  const cerrada = ot.estado === "terminada";

  async function enviar(estado: "en_ejecucion" | "terminada", avancePctForzado?: number) {
    setBusy(true);
    setMsg("");
    try {
      const avancePct =
        avancePctForzado ?? Math.max(0, Math.min(100, Number(f.avancePct) || 0));
      const res = await fetch(`/api/paradas/${paradaId}/avances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paradaOtId: ot.id,
          fecha,
          turno: turnoParada,
          estado,
          avancePct,
          hhPropias: Number(f.hhPropias) || 0,
          hhApoyo: Number(f.hhApoyo) || 0,
          comentario: f.comentario || null,
          registradoPor,
        }),
      });
      const data = await res.json();
      if (data?.ok === false) {
        setMsg(data.error ?? "Error al guardar");
        return;
      }
      if (Array.isArray(data?.rechazados) && data.rechazados.length > 0) {
        setMsg(data.rechazados[0]?.motivo ?? "OT rechazada");
        return;
      }
      setMsg(estado === "terminada" ? "OT cerrada." : "Avance guardado.");
      await onCambio();
      if (estado === "terminada") setAbierto(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f2847" }}>{ot.numeroOT}</span>
        <span style={{ fontSize: 12, color: "#64748b" }}>{ot.tag || "—"}</span>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            color: meta.color, background: meta.bg,
          }}
        >
          {meta.label} · {ot.avancePct}%
        </span>
        <span
          style={{
            fontSize: 12, color: "#334155", flex: 1, minWidth: 140,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {ot.descripcion}
        </span>
        {!cerrada && (
          <button
            onClick={() => setAbierto((v) => !v)}
            style={{ ...btnBase, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}
          >
            {abierto ? "Cerrar" : avanceHoy ? "Editar avance" : "Abrir / reportar"}
          </button>
        )}
      </div>

      {abierto && !cerrada && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 90 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>HH propias</span>
              <input type="number" min={0} step="0.5" value={f.hhPropias} onChange={(e) => set("hhPropias", e.target.value)} style={inp} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 90 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>HH apoyo</span>
              <input type="number" min={0} step="0.5" value={f.hhApoyo} onChange={(e) => set("hhApoyo", e.target.value)} style={inp} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 90 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Avance %</span>
              <input type="number" min={0} max={100} value={f.avancePct} onChange={(e) => set("avancePct", e.target.value)} style={inp} />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Comentario / tareas</span>
            <textarea value={f.comentario} onChange={(e) => set("comentario", e.target.value)} style={{ ...inp, minHeight: 52, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => enviar("en_ejecucion")} disabled={busy} style={{ ...btnBase, background: busy ? "#93c5fd" : "#2563eb", color: "white" }}>
              {busy ? "Guardando…" : "Guardar avance"}
            </button>
            <button onClick={() => enviar("terminada", 100)} disabled={busy} style={{ ...btnBase, background: busy ? "#86efac" : "#16a34a", color: "white" }}>
              Cerrar OT ✓
            </button>
            {msg && (
              <span style={{ fontSize: 11, color: msg.includes("cerrada") || msg.includes("guardado") ? "#15803d" : "#dc2626" }}>
                {msg}
              </span>
            )}
          </div>
        </div>
      )}

      {cerrada && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#15803d", fontWeight: 700 }}>
          OT terminada — reportada por el grupo.
        </div>
      )}
    </div>
  );
}
