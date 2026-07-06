/**
 * Login de Sync-MSC.
 * El login es el estándar del IAM (OIDC). Esta página solo:
 *  - sin error → inicia el flujo OIDC (/api/auth/login)
 *  - con ?error → muestra el motivo (evita loop de auto-login, ej. sin acceso)
 */
import { redirect } from "next/navigation";

const ERRORS: Record<string, string> = {
  sin_acceso:
    "Tu cuenta no tiene acceso al sistema Sync-MSC. Contacta al administrador para que te conceda el acceso desde el portal de identidad.",
  auth_error: "No se pudo completar el inicio de sesión. Intenta nuevamente.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const { error, redirect: dest } = await searchParams;

  // Sin error → iniciar el flujo OIDC directamente
  if (!error) {
    const target = dest && dest.startsWith("/") ? dest : "/inicio";
    redirect(`/api/auth/login?redirect=${encodeURIComponent(target)}`);
  }

  const message = ERRORS[error!] ?? ERRORS.auth_error;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(180deg, #061322 0%, #0f2847 30%, #1a3d6b 65%, #2a5a8a 100%)",
        padding: 24,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/LOGO1.png" alt="Sync MSC" style={{ width: 110, height: 110, objectFit: "contain" }} />
      </div>

      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, marginBottom: 40, letterSpacing: "0.04em" }}>
        Sistema de Gestión de Mantenimiento Planta
      </p>

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: "36px 32px",
          backdropFilter: "blur(20px)",
          textAlign: "center",
        }}
      >
        <h2 style={{ color: "white", fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
          Acceso no disponible
        </h2>
        <p style={{ color: "#fca5a5", fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
          {message}
        </p>
        <a
          href="/api/auth/login"
          style={{
            display: "inline-block",
            background: "#2563eb",
            color: "white",
            borderRadius: 8,
            padding: "12px 28px",
            fontWeight: 700,
            fontSize: 15,
            textDecoration: "none",
            letterSpacing: "0.04em",
          }}
        >
          Reintentar
        </a>
      </div>

      <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginTop: 40 }}>
        MANTENIMIENTO PLANTA
      </p>
    </div>
  );
}
