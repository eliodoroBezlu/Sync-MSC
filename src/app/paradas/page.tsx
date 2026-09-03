"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { NARANJA, ESTADO_PARADA_META, type ParadaResumen } from "./[id]/tipos";

// Roles con acceso al módulo (plan §10): Admin, Superintendente, Supervisor, Planificador.
const ROLES_VER = [1, 2, 3, 5];
// Crear / configurar parada: Admin, Superintendente, Planificador.
const ROLES_CONFIG = [1, 2, 5];

function fmtFecha(iso: string): string {
  const norm = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) + "T12:00:00" : iso;
  return new Date(norm).toLocaleDateString("es-BO", { day: "2-digit", month: "short" });
}

function siguienteCodigo(paradas: ParadaResumen[]): string {
  const nums = paradas
    .map((p) => /^PPML(\d+)$/i.exec(p.codigo.trim()))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => Number(m[1]));
  const max = nums.length ? Math.max(...nums) : 60;
  return `PPML${String(max + 1).padStart(3, "0")}`;
}

export default function ParadasPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  const [paradas, setParadas] = useState<ParadaResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const [form, setForm] = useState({
    codigo: "",
    nombre: "",
    planta: "",
    fechaPreparativosInicio: "",
    fechaEjecucionInicio: "",
    fechaEjecucionFin: "",
  });

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const load = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/paradas");
      const data = await res.json();
      setParadas(Array.isArray(data) ? data : []);
    } catch {
      setParadas([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function abrirModal() {
    setForm((f) => ({ ...f, codigo: siguienteCodigo(paradas) }));
    setError("");
    setCreando(true);
  }

  function set(campo: keyof typeof form, valor: string) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  async function crear() {
    if (!user) return;
    setError("");
    if (!form.codigo.trim() || !form.nombre.trim()) {
      setError("Código y nombre son obligatorios");
      return;
    }
    if (!form.fechaPreparativosInicio || !form.fechaEjecucionInicio || !form.fechaEjecucionFin) {
      setError("Completa las tres fechas");
      return;
    }
    try {
      const res = await fetch("/api/paradas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, planta: form.planta || null, creadoPor: user.email }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Error al crear la parada");
        return;
      }
      setCreando(false);
      router.push(`/paradas/${data.parada.id}`);
    } catch {
      setError("Error de red");
    }
  }

  async function borrar(e: React.MouseEvent, p: ParadaResumen) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`¿Borrar la parada "${p.codigo}"? Se eliminan sus OTs, grupos, avances y reportes. No se puede deshacer.`)) return;
    setBorrandoId(p.id);
    try {
      const res = await fetch(`/api/paradas/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok === false) {
        setError(data.error ?? "Error al borrar");
        return;
      }
      await load();
    } catch {
      setError("Error de red al borrar");
    } finally {
      setBorrandoId(null);
    }
  }

  if (loading || !user) return null;

  const puedeVer = ROLES_VER.includes(user.rol);
  const puedeConfig = ROLES_CONFIG.includes(user.rol);

  if (!puedeVer) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
        <AppHeader backHref="/ordenes" />
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
          Este módulo es para supervisores, superintendentes y planificación.
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/ordenes" />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f2847", margin: 0 }}>Parada de Planta</h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0" }}>
              Seguimiento y control de turnarounds — preparativos y ejecución
            </p>
          </div>
          {puedeConfig && (
            <button
              onClick={abrirModal}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: NARANJA, color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}
            >
              + Nueva Parada
            </button>
          )}
        </div>

        {creando && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div style={{ background: "white", borderRadius: 16, padding: 28, width: 400, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f2847", margin: "0 0 20px" }}>Nueva parada de planta</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Código</label>
                    <input value={form.codigo} onChange={(e) => set("codigo", e.target.value.toUpperCase())} placeholder="PPML061" style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Planta (opcional)</label>
                    <input value={form.planta} onChange={(e) => set("planta", e.target.value)} placeholder="ML" style={inp} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Nombre</label>
                  <input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Parada de Planta ML — Septiembre" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Inicio de preparativos</label>
                  <input type="date" value={form.fechaPreparativosInicio} onChange={(e) => set("fechaPreparativosInicio", e.target.value)} style={inp} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Inicio ejecución</label>
                    <input type="date" value={form.fechaEjecucionInicio} onChange={(e) => set("fechaEjecucionInicio", e.target.value)} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Fin ejecución</label>
                    <input type="date" value={form.fechaEjecucionFin} onChange={(e) => set("fechaEjecucionFin", e.target.value)} style={inp} />
                  </div>
                </div>
                {error && <div style={errBox}>{error}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button onClick={() => setCreando(false)} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                    Cancelar
                  </button>
                  <button onClick={crear} style={{ flex: 2, padding: "9px 0", borderRadius: 8, border: "none", background: NARANJA, color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Crear parada
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && !creando && <div style={{ ...errBox, marginBottom: 14 }}>{error}</div>}

        {cargando ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando paradas…</div>
        ) : paradas.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, background: "white", borderRadius: 14, border: "2px dashed #e2e8f0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🏭</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>No hay paradas registradas</div>
            {puedeConfig && <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Crea la primera con el botón de arriba</div>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {paradas.map((p) => {
              const meta = ESTADO_PARADA_META[p.estado] ?? { label: p.estado, color: "#64748b" };
              return (
                <Link key={p.id} href={`/paradas/${p.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "white", borderRadius: 12, padding: "14px 18px", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ minWidth: 64, height: 56, borderRadius: 12, background: `${NARANJA}14`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: NARANJA, textTransform: "uppercase" }}>Parada</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: NARANJA, lineHeight: 1 }}>{p.codigo.replace(/^PPML/i, "")}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                        {p.codigo} — {p.nombre}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        Prep. {fmtFecha(p.fechaPreparativosInicio)} · Ejec. {fmtFecha(p.fechaEjecucionInicio)}–{fmtFecha(p.fechaEjecucionFin)} · {p._count.ots} OTs · {p._count.reportesDiarios} reportes
                      </div>
                    </div>
                    <div style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${meta.color}20`, color: meta.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {meta.label}
                    </div>
                    {puedeConfig && (
                      <button
                        onClick={(e) => borrar(e, p)}
                        disabled={borrandoId === p.id}
                        title="Borrar parada"
                        style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, border: "1.5px solid #fecaca", background: "#fff5f5", color: "#dc2626", fontSize: 14, fontWeight: 700, cursor: borrandoId === p.id ? "default" : "pointer", opacity: borrandoId === p.id ? 0.5 : 1 }}
                      >
                        {borrandoId === p.id ? "…" : "🗑"}
                      </button>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, boxSizing: "border-box" };
const errBox: React.CSSProperties = { fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "8px 10px", borderRadius: 6 };
