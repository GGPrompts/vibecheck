import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@ast-grep/napi', 'better-sqlite3'],
};

export default nextConfig;
