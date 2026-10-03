"use client";

import Link from "next/link";
import { useUser, rolNombre } from "@/context/AuthContext";
import Image from "next/image";

const ROL_COLOR: Record<number, string> = {
  1: "#7c3aed",
  2: "#0891b2",
  3: "#2563eb",
  4: "#16a34a",
};

interface Props {
  backHref?: string;
}

export default function AppHeader({ backHref }: Props) {
  const { user, logout } = useUser();

  return (
    <header style={{
      background: "white",
      borderBottom: "1px solid #e2e8f0",
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      position: "sticky",
      top: 0,
      zIndex: 10,
    }}>
      {backHref && (
        <Link href={backHref} style={{ color: "#0f2847", display: "flex", alignItems: "center" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </Link>
      )}

      <Link href="/inicio" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Image src="/LOGO1.png" alt="Sync MSC" width={38} height={38} style={{ objectFit: "contain" }} />
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#0f2847", letterSpacing: "0.03em" }}>
            Sync MSC <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b" }}>MP</span>
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: -1 }}>
            Gestión de Mantenimiento Planta
          </div>
        </div>
      </Link>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Usuario */}
      {user && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", lineHeight: 1.2 }}>{user.nombre}</div>
            <span style={{
              display: "inline-block",
              background: (ROL_COLOR[user.rol] ?? "#64748b") + "18",
              color: ROL_COLOR[user.rol] ?? "#64748b",
              border: `1px solid ${(ROL_COLOR[user.rol] ?? "#64748b")}40`,
              borderRadius: 5,
              padding: "1px 7px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}>
              {rolNombre(user.rol).toUpperCase()}
            </span>
          </div>
          {/* La cuenta (contraseña, 2FA, passkeys) vive en el IAM Portal */}
          <a
            href="/api/iam-portal?to=perfil"
            target="_blank"
            rel="noopener noreferrer"
            title="Cambiar contraseña, 2FA y passkeys en el IAM Portal"
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "6px 10px",
              color: "#64748b",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 4,
              textDecoration: "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            Mi cuenta
          </a>
          <button
            onClick={logout}
            title="Cerrar sesión"
            style={{
              background: "none",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              color: "#64748b",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Salir
          </button>
        </div>
      )}
    </header>
  );
}
