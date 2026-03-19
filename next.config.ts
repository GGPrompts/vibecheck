import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@ast-grep/napi'],
};

export default nextConfig;
