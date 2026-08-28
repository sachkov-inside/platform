import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const applicationDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  logging: {
    incomingRequests: { ignore: [/^\/callback(?:[/?]|$)/u] },
  },
  experimental: {
    useTypeScriptCli: false,
  },
  output: "standalone",
  outputFileTracingRoot: join(applicationDirectory, "../.."),
  poweredByHeader: false,
  typedRoutes: true,
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;
