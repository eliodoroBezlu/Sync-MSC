"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { SessionPayload } from "@/lib/auth";

interface AuthContextValue {
  user: SessionPayload | null;
  loading: boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refetch: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  async function refetch() {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      setUser(data.ok ? data.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  }

  useEffect(() => {
    refetch();
    // Revalidar al volver a la pestaña: si un admin cambió el rol/áreas de este
    // usuario mientras la sesión seguía abierta, esto la refresca sin necesitar
    // un logout/login manual (ver src/app/api/auth/me/route.ts).
    function onFocus() { refetch(); }
    function onVisibility() { if (document.visibilityState === "visible") refetch(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useUser() {
  return useContext(AuthContext);
}

// Helpers de rol
export const esAdmin = (rol?: number) => rol === 1;
export const esSuperintendente = (rol?: number) => rol === 2;
export const esSupervisor = (rol?: number) => rol === 3;
export const esTecnico = (rol?: number) => rol === 4;
export const esPlanificador = (rol?: number) => rol === 5;
// Planificador (5) tiene mismo nivel de acceso operativo que Supervisor (3)
export const puedeRevisar = (rol?: number) => rol !== undefined && (rol <= 3 || rol === 5);
// Puede ver módulo de programación semanal: todos los roles
export const puedeVerSemanales = (rol?: number) => rol !== undefined && rol >= 1;
export const rolNombre = (rol?: number) => {
  const nombres: Record<number, string> = { 1: "Administrador", 2: "Superintendente", 3: "Supervisor", 4: "Técnico", 5: "Planificador" };
  return rol !== undefined ? (nombres[rol] ?? "—") : "—";
};
