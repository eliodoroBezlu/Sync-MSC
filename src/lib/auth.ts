import { SignJWT, jwtVerify } from "jose";
import { Rol, Disciplina } from "@/types";

const JWT_SECRET = process.env.JWT_SECRET || "sync-msc-secret-dev-2025";
const COOKIE_NAME = "sync_session";
const MAX_AGE = 60 * 60 * 8; // 8 horas

// jose (ESM) en lugar de jsonwebtoken (CJS): Turbopack lo empaqueta sin
// problemas y es el mismo esquema (HS256) que valida el proxy.
const secret = () => new TextEncoder().encode(JWT_SECRET);

export interface SessionPayload {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  areas: string[];
  disciplina: Disciplina;
}

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAX_AGE };
