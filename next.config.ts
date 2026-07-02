import type { NextConfig } from "next";

// Local dev: the repo lives under iCloud (symlinked from ~/Documents/GitHub);
// node_modules/.next are `*.nosync` dirs inside the repo (excluded from iCloud
// sync) behind same-dir symlinks, so realpaths stay inside the project. Pin the
// workspace root so Next never walks up and picks a stray lockfile. On the
// server (/opt/concierge, real node_modules) nothing changes.
const underICloud = __dirname.includes("com~apple~CloudDocs");

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "@microsoft/microsoft-graph-client"],
  ...(underICloud ? { turbopack: { root: __dirname } } : {}),
};

export default nextConfig;
