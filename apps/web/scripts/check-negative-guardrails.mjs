import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtures = [
  {
    root: "test/guardrails/fixtures/architecture/codegen-boundary",
    diagnostics: [
      "codegen runtime belongs to the backend transport module",
      "generated API types belong to the backend transport module",
      "manual Nest operation paths belong to the backend transport module",
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/backend-environment",
    diagnostics: ["browser code cannot address Nest directly"],
  },
  {
    root: "test/guardrails/fixtures/architecture/runtime-configuration",
    diagnostics: [
      "application runtime environment belongs to the server-only config module",
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/public-site-origin",
    diagnostics: ["the public site origin belongs to the link preview module"],
  },
  {
    root: "test/guardrails/fixtures/architecture/absolute-fetch",
    diagnostics: ["browser code cannot call a Nest operation by absolute URL"],
  },
  {
    root: "test/guardrails/fixtures/architecture/layer-direction",
    diagnostics: ["features cannot import the upper widgets layer"],
  },
  {
    root: "test/guardrails/fixtures/architecture/server-action",
    diagnostics: ["Server Actions are not part of the client-owned mutation path"],
  },
  {
    root: "test/guardrails/fixtures/architecture/dynamic-mutation",
    diagnostics: [
      "each browser mutation must declare a literal same-origin route and HTTP method",
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/editor-bundle",
    diagnostics: [
      "app/authoring/materials/page.tsx: reading and lightweight authoring routes cannot reach the Tiptap editor bundle",
      "app/(public)/(catalog)/materials/[slug]/page.tsx: reading and lightweight authoring routes cannot reach the Tiptap editor bundle",
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/proxy-dependencies",
    diagnostics: [
      "proxy.ts: proxy decides without a backend request; it cannot reach the backend or the session (via test/guardrails/fixtures/architecture/proxy-dependencies/proxy.ts)",
      "proxy.ts: proxy decides without a backend request; it cannot reach the backend or the session (via test/guardrails/fixtures/architecture/proxy-dependencies/catalog-address.ts)",
      "proxy.ts: proxy decides without a backend request; it cannot reach the backend or the session (via test/guardrails/fixtures/architecture/proxy-dependencies/session-cookie.ts)",
      "proxy.ts: proxy decides without a backend request; it cannot reach the backend or the session (via test/guardrails/fixtures/architecture/proxy-dependencies/direct-fetch.ts)",
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/prerendered-handler",
    diagnostics: [
      "app/api/swallowed/route.ts: a GET Route Handler starts with await connection(), or the build prerenders its answer",
      "app/api/reexported/route.ts: declare GET in the route file so that it starts with await connection()",
      "app/api/foreign-connection/route.ts: a GET Route Handler starts with await connection(), or the build prerenders its answer",
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/public-cache",
    diagnostics: [
      'inline-cache.ts: "use cache" belongs to a *.public-cache.server.ts module that reads the catalog as a guest',
      "personal.public-cache.server.ts: a cached catalog read cannot see the session; read it as a guest and keep the personal read uncached",
      'private.public-cache.server.ts: only the shared "use cache" is allowed; a per-session cache would carry protected content into prefetch',
      "legacy-cache.ts: unstable_cache is a second shared cache outside the guest-read rule; use a *.public-cache.server.ts module",
      "cookies.public-cache.server.ts: a cached catalog read cannot see the session; read it as a guest and keep the personal read uncached",
      "sign-in.public-cache.server.ts: a cached catalog read cannot see the session; read it as a guest and keep the personal read uncached",
      "unbounded.public-cache.server.ts: a cached catalog read sets its tag and lifetime through applyCatalogCachePolicy, or an authoring write cannot expire it",
      "second-read.public-cache.server.ts: a cached catalog read sets its tag and lifetime through applyCatalogCachePolicy, or an authoring write cannot expire it",
      'module-directive.public-cache.server.ts: declare "use cache" inside the function, not for the module, so that each cached read carries its own policy',
    ],
  },
  {
    root: "test/guardrails/fixtures/architecture/document-blocks",
    diagnostics: [
      "kit.ts: material document blocks belong to the shared block registry; import them from @inside/material-blocks",
      "callout.ts: material document blocks belong to the shared block registry; add the block there instead of declaring a node here",
    ],
  },
];

for (const fixture of fixtures) {
  const result = spawnSync(
    "node",
    ["scripts/check-web-architecture.mjs", fixture.root],
    { cwd: webRoot, encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.error !== undefined) throw result.error;
  if (result.status === 0) {
    throw new Error(`Web architecture unexpectedly accepted ${fixture.root}`);
  }
  for (const diagnostic of fixture.diagnostics) {
    if (!output.includes(diagnostic)) {
      throw new Error(
        `Web architecture failed ${fixture.root} without ${diagnostic}\n${output}`,
      );
    }
  }
}

const allowedExternalFetch = spawnSync(
  "node",
  [
    "scripts/check-web-architecture.mjs",
    "test/guardrails/fixtures/architecture/external-fetch",
  ],
  { cwd: webRoot, encoding: "utf8" },
);
if (allowedExternalFetch.error !== undefined) throw allowedExternalFetch.error;
if (allowedExternalFetch.status !== 0) {
  throw new Error(
    `Web architecture rejected an unrelated external API\n${allowedExternalFetch.stdout ?? ""}${allowedExternalFetch.stderr ?? ""}`,
  );
}

process.stdout.write("Negative Web transport guardrails passed.\n");
