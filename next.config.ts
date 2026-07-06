import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Paquetes CommonJS que Turbopack no debe empaquetar (se cargan como módulos
  // de Node en el servidor). Sin esto, los route handlers que los importan
  // fallan a compilar y devuelven 404.
  serverExternalPackages: ["@prisma/client", "openid-client", "jsonwebtoken"],
};

export default nextConfig;
