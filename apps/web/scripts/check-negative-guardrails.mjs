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
    diagnostics: ["lightweight authoring routes cannot reach the Tiptap editor bundle"],
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
