import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
