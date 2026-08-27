import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  logging: {
    incomingRequests: { ignore: [/^\/callback(?:[/?]|$)/u] },
  },
  experimental: {
    useTypeScriptCli: false,
  },
  poweredByHeader: false,
  typedRoutes: true,
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;
