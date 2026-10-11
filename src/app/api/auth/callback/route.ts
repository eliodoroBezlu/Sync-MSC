// app/api/auth/callback/route.ts
// Callback OIDC: canjea el código (PKCE), valida que el usuario tenga acceso
// al servicio sync-msc, sincroniza el Usuario espejo local desde el IAM
// (fuente de verdad) y emite la sesión `sync_session` de siempre.
import { NextRequest, NextResponse } from "next/server";
import { getOidcClient, OIDC_REDIRECT_URI, ID_TOKEN_COOKIE } from "@/lib/oidc";
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
import { asegurarFichaDeCuenta } from "@/lib/padron";

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

  // ── Toda persona que entra tiene ficha en el padrón del IAM: si su cuenta no
  //    la tiene, el IAM se la crea ya vinculada (nunca suelta). Sin ficha no se
  //    entra: en Sync cada persona es la copia de una ficha. ──
  if (!info.trabajador?.id) {
    try {
      const t = await asegurarFichaDeCuenta(
        {
          userId: info.sub,
          nombre: info.name ?? info.preferred_username ?? "Usuario",
          rol: mapSyncRole(access.roles),
          disciplina: access.metadata?.disciplina,
        },
        { id: info.sub, nombre: info.name ?? info.preferred_username ?? null },
      );
      info.trabajador = {
        id: t.id, ci: t.ci ?? undefined, jde: t.jde ?? undefined, nomina: t.nomina,
        puesto: t.puesto, area: t.area ?? undefined, superintendencia: t.superintendencia,
        disciplina: t.disciplina ?? undefined,
      };
      console.log(`[OIDC callback] ficha del padrón creada para la cuenta ${info.sub}`);
    } catch (err) {
      return fail(request, `no se pudo crear la ficha de ${info.sub}: ${(err as Error).message}`, "sin_ficha");
    }
  }
  const trabajadorId = info.trabajador.id!;

  // ── Derivar perfil desde la fuente de verdad (IAM) ──
  const rol: Rol = mapSyncRole(access.roles);
  const disciplina = normalizeDisciplina(
    info.trabajador.disciplina ?? access.metadata?.disciplina,
  );
  const areas = access.metadata?.areas ?? [];
  const nombre =
    info.trabajador.nomina ?? info.name ?? info.preferred_username ?? "Usuario";
  const jde = info.trabajador.jde ?? null;
  const puesto = info.trabajador.puesto ?? null;
  const superintendencia = info.trabajador.superintendencia ?? null;
  const areaTrabajo = info.trabajador.area ?? null;

  // ── La copia local: por su cuenta y, si es su primer ingreso, por su ficha
  //    (la persona pudo existir en Sync antes de tener cuenta) ──
  let usuario =
    (await prisma.usuario.findUnique({ where: { iamUserId: info.sub } })) ??
    (await prisma.usuario.findUnique({ where: { trabajadorId } }));

  // Si su cuenta cambió de ficha en el IAM, se sigue a la nueva, salvo que otra
  // persona de Sync ya la tenga (duplicado: se resuelve con "Fusionar").
  let enlace: { trabajadorId: string } | Record<string, never> = { trabajadorId };
  if (usuario && usuario.trabajadorId !== trabajadorId) {
    const otro = await prisma.usuario.findUnique({ where: { trabajadorId }, select: { id: true } });
    if (otro) {
      console.warn(`⚠️ [OIDC callback] la ficha ${trabajadorId} ya está enlazada a otra persona de Sync (${otro.id})`);
      enlace = {};
    }
  }

  // El email es único: si otra persona de Sync ya lo usa, no se le quita.
  let email = info.email ?? null;
  if (email) {
    const otro = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (otro && otro.id !== usuario?.id) {
      console.warn(`⚠️ [OIDC callback] el email ${email} ya es de otra persona de Sync (${otro.id})`);
      email = null;
    }
  }

  const data = {
    tieneCuentaIam: true,
    iamUserId: info.sub,
    nombre,
    email,
    rol,
    disciplina,
    jde,
    puesto,
    superintendencia,
    areaTrabajo,
    activo: true,
  };

  usuario = usuario
    ? await prisma.usuario.update({ where: { id: usuario.id }, data: { ...data, ...enlace } })
    : await prisma.usuario.create({ data: { ...data, trabajadorId } });

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
  // El logout lo necesita como id_token_hint para volver a Sync tras cerrar el SSO.
  if (tokenSet.id_token) {
    res.cookies.set(ID_TOKEN_COOKIE, tokenSet.id_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE,
      path: "/",
    });
  }
  res.cookies.delete(TX_COOKIE);
  return res;
}
