"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";

type AreaOpcion = { codigo: string; nombre: string };

const EXCLUIR_AREAS = new Set(["3110", "3111"]);

function getISO(date = new Date()) {
  const jan1  = new Date(date.getFullYear(), 0, 1);
  const days  = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
  const dow   = jan1.getDay() || 7;
  return Math.ceil((days + dow) / 7);
}

type PlanItem = {
  id: string;
  semana: number; anio: number; areaCodigo: string; disciplina: string;
  estado: string; creadoPor: string; createdAt: string;
  ots: { id: string }[];
  roster: { id: string }[];
};

const ESTADO_COLOR: Record<string, string> = {
  borrador: "#f59e0b",
  revision: "#3b82f6",
  publicado: "#16a34a",
};

export default function PlanificacionPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  const [planes, setPlanes] = useState<PlanItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [creandoPlan, setCreandoPlan] = useState(false);
  const [nuevoSemana, setNuevoSemana] = useState(getISO());
  const [areas, setAreas]     = useState<AreaOpcion[]>([]);
  const [nuevoArea, setNuevoArea]     = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    fetch("/api/areas")
      .then(res => res.json())
      .then((data: AreaOpcion[]) => {
        // "Mina" (3110) y "Planta de Proceso" (3111) son nodos generales de
        // la jerarquía de equipos, no áreas mecánicas reales de planificación.
        const areasPlanificacion = data.filter(a => !EXCLUIR_AREAS.has(a.codigo));
        setAreas(areasPlanificacion);
        setNuevoArea(prev => prev || areasPlanificacion[0]?.codigo || "");
      })
      .catch(() => setAreas([]));
  }, []);

  const loadPlanes = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/planificacion?anio=${anio}&limit=100`);
      const data = await res.json();
      setPlanes(Array.isArray(data) ? data : []);
    } catch {
      setPlanes([]);
    } finally {
      setCargando(false);
    }
  }, [anio]);

  useEffect(() => { loadPlanes(); }, [loadPlanes]);

  async function crearPlan() {
    if (!user) return;
    setError("");
    try {
      const res = await fetch("/api/planificacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ semana: nuevoSemana, anio, areaCodigo: nuevoArea, creadoPor: user.email }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Error"); return; }
      setCreandoPlan(false);
      router.push(`/planificacion/${data.plan.id}`);
    } catch {
      setError("Error de red");
    }
  }

  if (loading || !user) return null;

  const semanaActual = getISO();

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/ordenes" />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f2847", margin: 0 }}>Planificación Semanal</h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0" }}>Programas semanales de mantenimiento por área</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={anio}
              onChange={e => setAnio(Number(e.target.value))}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, fontWeight: 600 }}
            >
              {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
            </select>
            <button
              onClick={() => setCreandoPlan(true)}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: "#7c3aed", color: "white", fontWeight: 700,
                fontSize: 13, cursor: "pointer",
              }}
            >
              + Nuevo plan
            </button>
          </div>
        </div>

        {/* Modal nuevo plan */}
        {creandoPlan && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}>
            <div style={{ background: "white", borderRadius: 16, padding: 28, width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0f2847", margin: "0 0 20px" }}>Nuevo plan semanal</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Semana ISO</label>
                  <input
                    type="number" min={1} max={53}
                    value={nuevoSemana}
                    onChange={e => setNuevoSemana(Number(e.target.value))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, boxSizing: "border-box" }}
                  />
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>Semana actual: {semanaActual}</div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Área</label>
                  <select
                    value={nuevoArea}
                    onChange={e => setNuevoArea(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14 }}
                  >
                    {areas.map(a => <option key={a.codigo} value={a.codigo}>{a.nombre} ({a.codigo})</option>)}
                  </select>
                </div>
                {error && <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "8px 10px", borderRadius: 6 }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => setCreandoPlan(false)}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                  >Cancelar</button>
                  <button
                    onClick={crearPlan}
                    disabled={!nuevoArea}
                    style={{ flex: 2, padding: "9px 0", borderRadius: 8, border: "none", background: nuevoArea ? "#7c3aed" : "#c4b5fd", color: "white", fontWeight: 700, fontSize: 13, cursor: nuevoArea ? "pointer" : "not-allowed" }}
                  >Crear plan</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lista de planes */}
        {cargando ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando planes…</div>
        ) : planes.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 60, background: "white",
            borderRadius: 14, border: "2px dashed #e2e8f0",
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>No hay planes para {anio}</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Crea el primer plan semanal con el botón de arriba</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {planes.map(p => {
              const area = areas.find(a => a.codigo === p.areaCodigo);
              return (
                <Link key={p.id} href={`/planificacion/${p.id}`} style={{ textDecoration: "none" }}>
                  <div style={{
                    background: "white", borderRadius: 12, padding: "14px 18px",
                    border: "1.5px solid #e2e8f0", display: "flex",
                    alignItems: "center", gap: 14,
                    transition: "box-shadow 0.2s",
                  }}>
                    {/* Semana badge */}
                    <div style={{
                      minWidth: 56, height: 56, borderRadius: 12,
                      background: "#7c3aed14", display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#7c3aed", textTransform: "uppercase" }}>Sem</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#7c3aed", lineHeight: 1 }}>{p.semana}</div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
                        {area?.nombre ?? p.areaCodigo} — {p.anio}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {p.ots.length} OTs · {p.roster.length} técnicos · creado por {p.creadoPor}
                      </div>
                    </div>

                    <div style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: `${ESTADO_COLOR[p.estado]}20`,
                      color: ESTADO_COLOR[p.estado],
                      textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>{p.estado}</div>
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
