"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SessionPayload } from "@/lib/auth";

// Rutas accesibles sin sesión — no deben disparar el redirect automático a /login.
function esRutaPublica(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/pub/");
}

interface AuthContextValue {
  user: SessionPayload | null;
  loading: boolean;
  refetch: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refetch: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  // Ref en vez de leer `pathname` directo: los listeners de focus/visibilitychange
  // se registran una sola vez (efecto con deps []), así que su closure quedaría
  // congelada en la ruta de montaje si no se lee siempre el valor actual por ref.
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  async function refetch() {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.ok) {
        setUser(data.user);
      } else {
        setUser(null);
        // Sesión expirada/inválida: sacar al usuario directo al login en vez de
        // dejarlo atrapado dentro de una pantalla protegida sin datos.
        if (!esRutaPublica(pathnameRef.current)) {
          router.replace("/login");
        }
      }
    } catch {
      // Error de red — no necesariamente significa sesión inválida, no redirigir.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  // Navegación completa (no fetch): /api/auth/logout redirige al IAM, que cierra
  // la sesión SSO y vuelve a Sync. Con fetch esa cadena ocurriría por detrás y
  // la sesión del IAM seguiría viva → el login volvería a entrar solo.
  function logout() {
    setUser(null);
    window.location.href = "/api/auth/logout";
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
