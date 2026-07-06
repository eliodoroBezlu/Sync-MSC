// app/api/auth/callback/route.ts
// Callback OIDC: canjea el código (PKCE), valida que el usuario tenga acceso
// al servicio sync-msc, sincroniza el Usuario espejo local desde el IAM
// (fuente de verdad) y emite la sesión `sync_session` de siempre.
import { NextRequest, NextResponse } from "next/server";
import { getOidcClient, OIDC_REDIRECT_URI } from "@/lib/oidc";
import { getPublicOrigin } from "@/lib/public-url";
import { prisma } from "@/lib/prisma";
import { signToken, COOKIE_NAME, MAX_AGE, SessionPayload } from "@/lib/auth";
import {
  getSyncAccess,
  mapSyncRole,
  normalizeDisciplina,
  type OidcUserInfo,
} from "@/lib/sync-profile";
import type { Rol } from "@/types";

export const runtime = "nodejs";

const TX_COOKIE = "oidc_tx";

interface OidcTx {
  codeVerifier: string;
  state: string;
  nonce: string;
  redirect: string;
}

function fail(request: NextRequest, reason: string, code = "auth_error"): NextResponse {
  console.error("💥 [OIDC callback]", reason);
  const url = new URL("/login", getPublicOrigin(request));
  url.searchParams.set("error", code);
  const res = NextResponse.redirect(url);
  res.cookies.delete(TX_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const txRaw = request.cookies.get(TX_COOKIE)?.value;
  if (!txRaw) return fail(request, "oidc_tx ausente");

  let tx: OidcTx;
  try {
    tx = JSON.parse(txRaw) as OidcTx;
  } catch {
    return fail(request, "oidc_tx inválido");
  }

  const client = getOidcClient();
  const params = client.callbackParams(request.url);

  let tokenSet;
  try {
    tokenSet = await client.callback(OIDC_REDIRECT_URI, params, {
      state: tx.state,
      nonce: tx.nonce,
      code_verifier: tx.codeVerifier,
    });
  } catch (err) {
    return fail(request, `canje fallido: ${(err as Error).message}`);
  }

  if (!tokenSet.access_token) return fail(request, "token set sin access_token");

  // Perfil completo desde el IAM (trabajador + service_access)
  let info: OidcUserInfo;
  try {
    info = (await client.userinfo(tokenSet.access_token)) as unknown as OidcUserInfo;
  } catch (err) {
    return fail(request, `userinfo fallido: ${(err as Error).message}`);
  }

  // ── Gate de acceso: debe tener el servicio sync-msc concedido ──
  const access = getSyncAccess(info);
  if (!access) {
    return fail(request, `usuario ${info.sub} sin acceso a sync-msc`, "sin_acceso");
  }

  // ── Derivar perfil desde la fuente de verdad (IAM) ──
  const rol: Rol = mapSyncRole(access.roles);
  // disciplina: del Trabajador (centralizado) o del metadata del acceso (fallback
  // para usuarios sin ficha Trabajador, ej. los migrados sin jde).
  const disciplina = normalizeDisciplina(
    info.trabajador?.disciplina ?? access.metadata?.disciplina,
  );
  const areas = access.metadata?.areas ?? [];
  const nombre =
    info.trabajador?.nomina ?? info.name ?? info.preferred_username ?? "Usuario";
  const email = info.email ?? null;
  const jde = info.trabajador?.jde ?? null;
  const puesto = info.trabajador?.puesto ?? null;
  const superintendencia = info.trabajador?.superintendencia ?? null;
  const areaTrabajo = info.trabajador?.area ?? null;

  // ── Sincronizar el Usuario espejo (vincular por iamUserId, fallback email/jde) ──
  let usuario = await prisma.usuario.findUnique({ where: { iamUserId: info.sub } });
  if (!usuario) {
    const or: Array<Record<string, string>> = [];
    if (email) or.push({ email });
    if (jde) or.push({ jde });
    if (or.length) usuario = await prisma.usuario.findFirst({ where: { OR: or } });
  }

  const data = {
    iamUserId: info.sub,
    nombre,
    email,
    rol,
    disciplina,
    jde,
    puesto,
    superintendencia,
    areaTrabajo,
    passwordHash: null,
    activo: true,
  };

  usuario = usuario
    ? await prisma.usuario.update({ where: { id: usuario.id }, data })
    : await prisma.usuario.create({ data });

  // Sincronizar áreas asignadas (solo las que existen en el catálogo local)
  await prisma.usuarioArea.deleteMany({ where: { usuarioId: usuario.id } });
  if (areas.length) {
    const existentes = await prisma.area.findMany({
      where: { codigo: { in: areas } },
      select: { codigo: true },
    });
    if (existentes.length) {
      await prisma.usuarioArea.createMany({
        data: existentes.map((a) => ({ usuarioId: usuario!.id, areaCodigo: a.codigo })),
        skipDuplicates: true,
      });
    }
  }

  // ── Emitir la sesión local de Sync (mismo SessionPayload de siempre) ──
  const payload: SessionPayload = {
    id: usuario.id,
    nombre,
    email: email ?? "",
    rol,
    areas,
    disciplina,
  };
  const token = await signToken(payload);

  const dest = tx.redirect && tx.redirect.startsWith("/") ? tx.redirect : "/inicio";
  const res = NextResponse.redirect(new URL(dest, getPublicOrigin(request)));
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  res.cookies.delete(TX_COOKIE);
  return res;
}
