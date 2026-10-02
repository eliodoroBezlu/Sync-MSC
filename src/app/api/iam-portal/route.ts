// app/api/iam-portal/route.ts
// Redirige a una sección del IAM Portal: ?to=perfil (cambiar contraseña, 2FA,
// passkeys) o ?to=admin (gestionar usuarios y accesos). Requiere sesión (proxy).
import { NextRequest, NextResponse } from "next/server";
import { getIamPortalUrl, DESTINOS_PORTAL, esDestinoPortal } from "@/lib/iam-portal";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const base = getIamPortalUrl();
  if (!base) {
    console.error("💥 [iam-portal] Falta IAM_PORTAL_URL (y no se puede derivar de IAM_CORE_PUBLIC_URL)");
    return NextResponse.json(
      { ok: false, error: "El enlace al IAM Portal no está configurado." },
      { status: 500 },
    );
  }

  const to = request.nextUrl.searchParams.get("to");
  const destino = esDestinoPortal(to) ? to : "perfil";
  return NextResponse.redirect(`${base}${DESTINOS_PORTAL[destino]}`);
}
