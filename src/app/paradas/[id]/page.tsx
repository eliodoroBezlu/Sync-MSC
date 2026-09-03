"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import TableroParada from "./TableroParada";
import ListaOtsParada from "./ListaOtsParada";
import PanelPreparativos from "./PanelPreparativos";
import AvanceDiario from "./AvanceDiario";
import ReporteDiarioSupervisor from "./ReporteDiarioSupervisor";
import ConfigParada from "./ConfigParada";
import {
  NARANJA,
  ESTADO_PARADA_META,
  type ParadaDetalle,
  type TableroParada as TableroData,
} from "./tipos";

const ROLES_VER = [1, 2, 3, 5];
const ROLES_CONFIG = [1, 2, 5];
const ROLES_REPORTE = [3, 5];

type Tab = "resumen" | "preparativos" | "ejecucion" | "reportes" | "config";

function hoyYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ParadaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useUser();
  const router = useRouter();

  const [parada, setParada] = useState<ParadaDetalle | null>(null);
  const [tablero, setTablero] = useState<TableroData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noExiste, setNoExiste] = useState(false);
  const [tab, setTab] = useState<Tab>("resumen");
  const [hoy, setHoy] = useState<string>(hoyYmd());

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const loadParada = useCallback(async () => {
    const res = await fetch(`/api/paradas/${id}`);
    if (res.status === 404) {
      setNoExiste(true);
      return;
    }
    const data = await res.json();
    setParada(data);
  }, [id]);

  const loadTablero = useCallback(
    async (fecha: string) => {
      const res = await fetch(`/api/paradas/${id}/tablero?hoy=${fecha}`);
      if (!res.ok) return;
      const data = await res.json();
      setTablero(data.tablero);
    },
    [id],
  );

  const recargar = useCallback(async () => {
    await Promise.all([loadParada(), loadTablero(hoy)]);
  }, [loadParada, loadTablero, hoy]);

  useEffect(() => {
    setCargando(true);
    Promise.all([loadParada(), loadTablero(hoy)]).finally(() => setCargando(false));
    // Solo al montar / cambiar de parada; el cambio de `hoy` lo maneja el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadTablero(hoy);
  }, [hoy, loadTablero]);

  if (loading || !user) return null;

  const puedeVer = ROLES_VER.includes(user.rol);
  const puedeConfig = ROLES_CONFIG.includes(user.rol);
  const puedeReporte = ROLES_REPORTE.includes(user.rol);

  if (!puedeVer) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
        <AppHeader backHref="/paradas" />
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
          No tienes acceso a este módulo.
        </div>
      </div>
    );
  }

  if (noExiste) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
        <AppHeader backHref="/paradas" />
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>Parada no encontrada.</div>
      </div>
    );
  }

  const meta = parada ? ESTADO_PARADA_META[parada.estado] ?? { label: parada.estado, color: "#64748b" } : null;

  const tabs: { key: Tab; label: string; oculto?: boolean }[] = [
    { key: "resumen", label: "Resumen" },
    { key: "preparativos", label: "Preparativos" },
    { key: "ejecucion", label: "Ejecución" },
    { key: "reportes", label: "Reportes" },
    { key: "config", label: "Configuración", oculto: !puedeConfig },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/paradas" />

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 16px 48px" }}>
        {/* Encabezado parada */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847", margin: 0 }}>
            {parada ? `${parada.codigo} — ${parada.nombre}` : "Cargando…"}
          </h1>
          {meta && (
            <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${meta.color}20`, color: meta.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {meta.label}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
            <label htmlFor="hoy-sel">Fecha de corte</label>
            <input
              id="hoy-sel"
              type="date"
              value={hoy}
              onChange={(e) => setHoy(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12 }}
            />
          </div>
        </div>

        {/* Tablero fijo */}
        {tablero ? (
          <div style={{ position: "sticky", top: 8, zIndex: 20, marginBottom: 16 }}>
            <TableroParada tablero={tablero} hoy={hoy} />
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", background: "white", borderRadius: 14, marginBottom: 16 }}>
            Cargando indicadores…
          </div>
        )}

        {/* Pestañas */}
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.filter((t) => !t.oculto).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: "8px 8px 0 0",
                background: tab === t.key ? "white" : "#e2e8f0",
                borderBottom: tab === t.key ? `2px solid ${NARANJA}` : "2px solid transparent",
                fontWeight: tab === t.key ? 700 : 500,
                fontSize: 13,
                color: tab === t.key ? "#0f2847" : "#64748b",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ background: "white", borderRadius: "0 12px 12px 12px", padding: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          {cargando || !parada ? (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando…</div>
          ) : tab === "resumen" ? (
            <ListaOtsParada parada={parada} puedeEditar={puedeConfig} onChange={recargar} />
          ) : tab === "preparativos" ? (
            <PanelPreparativos parada={parada} puedeEditar={puedeConfig || puedeReporte} onChange={recargar} />
          ) : tab === "ejecucion" ? (
            <AvanceDiario parada={parada} puedeEditar={puedeReporte} onChange={recargar} />
          ) : tab === "reportes" ? (
            <ReporteDiarioSupervisor parada={parada} tablero={tablero} puedeEmitir={puedeReporte} usuario={user} onChange={recargar} />
          ) : (
            <ConfigParada parada={parada} onChange={recargar} onDeleted={() => router.replace("/paradas")} />
          )}
        </div>
      </main>
    </div>
  );
}
