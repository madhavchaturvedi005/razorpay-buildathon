import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL;

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    if (!backend) return [];
    return [
      { source: "/api/:path*", destination: `${backend.replace(/\/$/, "")}/api/:path*` },
      { source: "/health", destination: `${backend.replace(/\/$/, "")}/health` },
    ];
  },
};

export default nextConfig;
