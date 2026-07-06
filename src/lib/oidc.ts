/**
 * Cliente OIDC de Sync-MSC (Authorization Code + PKCE).
 * Solo server-side — el client_secret nunca llega al browser.
 *
 * Endpoints construidos explícitamente (no Issuer.discover) para evitar
 * mismatch de issuer. IAM_CORE_PUBLIC_URL = base pública de la API del IdP
 * ya con prefijo:
 *   - directo al core:       http://localhost:4000/api
 *   - vía proxy del portal:  https://<portal>/api/iam   (modelo Keycloak)
 */
import { Issuer, generators, type Client } from "openid-client";

const IAM_CORE_PUBLIC_URL = (
  process.env.IAM_CORE_PUBLIC_URL || "http://localhost:4000/api"
).replace(/\/+$/, "");

const OIDC_ISSUER = process.env.OIDC_ISSUER || "iam-core";
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || "sync-msc";
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "";

export const OIDC_REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI || "http://localhost:3000/api/auth/callback";

let cachedClient: Client | null = null;

export function getOidcClient(): Client {
  if (cachedClient) return cachedClient;

  const issuer = new Issuer({
    issuer: OIDC_ISSUER,
    authorization_endpoint: `${IAM_CORE_PUBLIC_URL}/oidc/authorize`,
    token_endpoint: `${IAM_CORE_PUBLIC_URL}/oidc/token`,
    userinfo_endpoint: `${IAM_CORE_PUBLIC_URL}/oidc/userinfo`,
    jwks_uri: `${IAM_CORE_PUBLIC_URL}/auth/.well-known/jwks.json`,
    end_session_endpoint: `${IAM_CORE_PUBLIC_URL}/oidc/logout`,
  });

  cachedClient = new issuer.Client({
    client_id: OIDC_CLIENT_ID,
    client_secret: OIDC_CLIENT_SECRET,
    redirect_uris: [OIDC_REDIRECT_URI],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  });

  return cachedClient;
}

export { generators };
