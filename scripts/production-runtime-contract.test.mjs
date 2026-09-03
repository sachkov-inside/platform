import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repositoryRoot, path), "utf8");

const runtime = {
  caddy: read("infra/production/runtime/platform.caddy"),
  compose: read("compose.production.yaml"),
  composeEnvironment: read("config/compose/production/compose.env.example"),
  releaseWorkflow: read(".github/workflows/release.yml"),
};

describe("production runtime architecture contract", () => {
  it("runs seven application processes only from manifest-selected images", () => {
    assertRuntimeContract(runtime);
  });

  it("rejects a source build added to the runtime Compose", () => {
    assert.throws(
      () => assertRuntimeContract({
        ...runtime,
        compose: runtime.compose.replace(
          "    command: [\"node\", \"dist/entrypoints/api.js\"]",
          "    build: .\n    command: [\"node\", \"dist/entrypoints/api.js\"]",
        ),
      }),
      /must not build application source/u,
    );
  });

  it("rejects a broad integration proxy that exposes unknown callbacks", () => {
    assert.throws(
      () => assertRuntimeContract({
        ...runtime,
        caddy: runtime.caddy.replace(
          "respond @unknown_integration 404",
          "reverse_proxy @unknown_integration {$PLATFORM_API_UPSTREAM:127.0.0.1:13001}",
        ),
      }),
      /unknown integration routes must fail closed/u,
    );
  });
});

function assertRuntimeContract(files) {
  if (/^\s+build:/mu.test(files.compose)) {
    throw new Error("production runtime must not build application source");
  }
  const services = [
    "migrations",
    "api",
    "mcp",
    "material-assets-worker",
    "profile-avatars-worker",
    "video-deletions-worker",
    "web",
  ];
  for (const service of services) {
    assert.match(files.compose, new RegExp(`^  ${service}:$`, "mu"));
  }
  const serviceBlock = files.compose.split("\nservices:\n")[1]?.split("\nnetworks:\n")[0] ?? "";
  assert.deepEqual(
    [...serviceBlock.matchAll(/^ {2}[a-z][a-z0-9-]*:$/gmu)].map(([line]) => line.trim()),
    services.map((service) => `${service}:`),
  );
  assert.match(files.compose, /image: \$\{PLATFORM_BACKEND_IMAGE_REPOSITORY:[^}]+\}@sha256:\$\{PLATFORM_BACKEND_IMAGE_DIGEST:/u);
  assert.match(files.compose, /image: \$\{PLATFORM_WEB_IMAGE_REPOSITORY:[^}]+\}@sha256:\$\{PLATFORM_WEB_IMAGE_DIGEST:/u);
  assert.match(files.composeEnvironment, /PLATFORM_BACKEND_IMAGE_REPOSITORY=ghcr\.io\/sachkov-inside\/platform-backend/u);
  assert.match(files.composeEnvironment, /PLATFORM_BACKEND_IMAGE_DIGEST=replace-with-64-lowercase-hex-characters/u);
  assert.match(files.composeEnvironment, /PLATFORM_WEB_IMAGE_REPOSITORY=ghcr\.io\/sachkov-inside\/platform-web/u);
  assert.match(files.composeEnvironment, /PLATFORM_WEB_IMAGE_DIGEST=replace-with-64-lowercase-hex-characters/u);
  assert.doesNotMatch(files.compose, /^ {2}(?:postgres|caddy):$/mu);
  assert.match(files.compose, /database:\n {4}external: true\n {4}name: \$\{FOUNDATION_DATABASE_NETWORK:/u);
  assert.match(files.compose, /application:\n {4}internal: true/u);
  assert.match(files.compose, /127\.0\.0\.1:\$\{PLATFORM_(?:API|MCP|WEB)_LOOPBACK_PORT:/u);
  assert.match(files.compose, /dist\/infrastructure\/worker-healthcheck\.js/u);
  assert.match(files.releaseWorkflow, /INSIDE_RELEASE_VERSION=\$\{\{ needs\.plan\.outputs\.version \}\}/u);
  assert.match(files.releaseWorkflow, /INSIDE_SOURCE_SHA=\$\{\{ needs\.plan\.outputs\.source_sha \}\}/u);

  for (const path of [
    "/integrations/telegram/v1/membership-evidence",
    "/integrations/kinescope/v1/webhook",
    "/integrations/kinescope/v1/authorize",
    "/mcp",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    assert.match(files.caddy, new RegExp(`path ${escapeRegExp(path)}$`, "mu"));
  }
  if (!/@unknown_integration path \/integrations\/\*\n\t\trespond @unknown_integration 404/u.test(files.caddy)) {
    throw new Error("unknown integration routes must fail closed");
  }
  assert.match(files.caddy, /@private_health path \/health \/health\/\* \/_health\/\*/u);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
