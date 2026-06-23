"use client";

import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";

type Modulo = {
  href: string; label: string; descripcion: string;
  icon: React.ReactNode; color: string; badge?: string;
  soloInst?: boolean;   // true = solo disciplina INST (+ admin)
  soloSup?: boolean;    // true = solo roles 1–3
  soloAdmin?: boolean;  // true = solo rol 1 (Admin)
};

const TODOS_MODULOS: Modulo[] = [
  {
    href: "/ordenes/registro",
    label: "Registro de OT",
    descripcion: "Ingreso de órdenes en campo",
    color: "#0f2847",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    href: "/ordenes/reporte",
    label: "Reporte de OT",
    descripcion: "Revisión y cierre supervisor",
    color: "#0f2847",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    href: "/ordenes/turnero",
    label: "Bitácora Turnero",
    descripcion: "Registro semanal de OTs de guardia",
    color: "#d97706",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    href: "/ordenes/turno",
    label: "Reporte Turno Supervisor",
    descripcion: "Handover supervisor — gestión de OTs y recomendaciones",
    color: "#0f2847",
    soloSup: true,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: "/ordenes/turno-tecnico",
    label: "Reporte Turno Técnico",
    descripcion: "Registro del turno por técnico / turnero — genera PDF",
    color: "#d97706",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/ordenes/tag",
    label: "Reporte por TAG",
    descripcion: "Historial de equipos (ISO 14224)",
    color: "#0f2847",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: "/ordenes/semanales",
    label: "OTs Semanales por Área",
    descripcion: "Programación y dashboard semanal",
    color: "#0f2847",
    soloSup: false,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: "/ordenes/calibracion",
    label: "Registro de Calibración",
    descripcion: "Certificados y calibración de instrumentos",
    badge: "Instrumentación",
    color: "#1e4d8c",
    soloInst: true,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    href: "/planificacion",
    label: "Planificación",
    descripcion: "Programas semanales de mantenimiento por área",
    badge: "Planificación",
    color: "#7c3aed",
    soloSup: true,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="8" y1="14" x2="8" y2="14" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="12" y1="14" x2="16" y2="14" />
        <line x1="8" y1="18" x2="8" y2="18" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="12" y1="18" x2="16" y2="18" />
      </svg>
    ),
  },
  {
    href: "/ordenes/configuracion",
    label: "Configuración / Adición de Datos",
    descripcion: "Datos maestros, personal y parámetros",
    badge: "Administrador",
    color: "#374151",
    soloAdmin: true,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

function ModuleCard({ href, label, descripcion, icon, color, badge }: Modulo) {
  return (
    <Link href={href} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      background: "white", borderRadius: 14, padding: "20px 12px",
      textDecoration: "none", border: `2px solid ${color}18`,
      boxShadow: "0 2px 12px rgba(15,40,71,0.07)",
      transition: "all 0.2s",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: `${color}14`, display: "flex",
        alignItems: "center", justifyContent: "center", color,
      }}>
        {icon}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.4 }}>{descripcion}</div>
        {badge && (
          <span style={{
            display: "inline-block", marginTop: 6,
            background: color === "#1e4d8c" ? "#dbeafe" : "#f1f5f9",
            color: color === "#1e4d8c" ? "#1e4d8c" : "#475569",
            fontSize: 10, fontWeight: 700, padding: "2px 8px",
            borderRadius: 20, letterSpacing: "0.05em"
          }}>
            {badge}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function OrdenesPage() {
  const { user } = useUser();

  const esAdmin   = user?.rol === 1;
  const esInst    = user?.disciplina === "INST";
  const puedeConf = user ? user.rol <= 3 : false;
  const esTESA    = user?.rol === 6 && user?.areas?.includes("3348");

  const MODULOS_TESA = ["/ordenes/registro", "/ordenes/reporte", "/ordenes/tag", "/ordenes/semanales"];

  const modulos = TODOS_MODULOS.filter((m) => {
    if (esAdmin) return true;
    if (esTESA) return MODULOS_TESA.includes(m.href);
    if (m.soloAdmin && !esAdmin) return false;
    if (m.soloInst && !esInst) return false;
    if (m.soloSup  && !puedeConf) return false;
    return true;
  });

  // Módulos principales (primeros 4) y secundarios (resto)
  const principales = modulos.slice(0, 4);
  const secundarios = modulos.slice(4);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/inicio" />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847" }}>Órdenes de Trabajo</h1>
          <p style={{ color: "#64748b", fontSize: 13 }}>Seleccione el módulo a utilizar</p>
        </div>

        {/* Grilla siempre de 2 columnas */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          {principales.map((m) => <ModuleCard key={m.href} {...m} />)}
        </div>

        {secundarios.length > 0 && (
          <>
            <div style={{ height: 1, background: "#e2e8f0", margin: "8px 0 12px" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {secundarios.map((m) => <ModuleCard key={m.href} {...m} />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
