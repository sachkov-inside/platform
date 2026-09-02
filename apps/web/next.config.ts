import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const applicationDirectory = dirname(fileURLToPath(import.meta.url));
const scriptSources = process.env.NODE_ENV === "development"
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://player.kinescope.io"
  : "script-src 'self' 'unsafe-inline' https://player.kinescope.io";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:9000 https://storage.yandexcloud.net https://*.storage.yandexcloud.net https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  "media-src 'self' blob: https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  scriptSources,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  "frame-src https://kinescope.io https://*.kinescope.io",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  logging: {
    incomingRequests: { ignore: [/^\/callback(?:[/?]|$)/u] },
  },
  output: "standalone",
  outputFileTracingRoot: join(applicationDirectory, "../.."),
  poweredByHeader: false,
  headers: () => Promise.resolve([{
    headers: [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ],
    source: "/:path*",
  }]),
  typedRoutes: true,
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;
