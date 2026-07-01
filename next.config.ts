import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "@microsoft/microsoft-graph-client"],
};

export default nextConfig;
