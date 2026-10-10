// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeIdentity } from "../packages/runtime-identity/index.mjs";

test("local production web can share the API image identity while providers stay in development mode", () => {
  const image = { release: "v7", sourceSha: "7".repeat(40) };
  const identity = resolveRuntimeIdentity({
    mode: "development",
    environment: {
      PLATFORM_LOCAL_RELEASE_IDENTITY: "image",
      PLATFORM_RELEASE_VERSION: "v7",
      PLATFORM_SOURCE_SHA: "7".repeat(40),
    },
    embeddedIdentity: image,
  });

  assert.deepEqual(identity, image);
});

test("local image identity rejects a runtime source that differs from the image", () => {
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        mode: "development",
        environment: {
          PLATFORM_LOCAL_RELEASE_IDENTITY: "image",
          PLATFORM_RELEASE_VERSION: "v7",
          PLATFORM_SOURCE_SHA: "8".repeat(40),
        },
        embeddedIdentity: { release: "v7", sourceSha: "7".repeat(40) },
      }),
    /Runtime release identity does not match the immutable image identity/u,
  );
});

test("ordinary development keeps its deterministic identity without the local image opt-in", () => {
  assert.deepEqual(
    resolveRuntimeIdentity({
      mode: "development",
      environment: {
        PLATFORM_RELEASE_VERSION: "v7",
        PLATFORM_SOURCE_SHA: "7".repeat(40),
      },
    }),
    { release: "development", sourceSha: "0".repeat(40) },
  );
});

test("the local image opt-in cannot bypass production image equality", () => {
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        mode: "production",
        environment: {
          PLATFORM_LOCAL_RELEASE_IDENTITY: "image",
          PLATFORM_RELEASE_VERSION: "v7",
          PLATFORM_SOURCE_SHA: "8".repeat(40),
        },
        embeddedIdentity: { release: "v7", sourceSha: "7".repeat(40) },
      }),
    /Runtime release identity does not match the immutable image identity/u,
  );
});

test("local image identity requires both runtime identity values", () => {
  assert.throws(
    () =>
      resolveRuntimeIdentity({
        mode: "development",
        environment: {
          PLATFORM_LOCAL_RELEASE_IDENTITY: "image",
          PLATFORM_RELEASE_VERSION: "v7",
        },
        embeddedIdentity: { release: "v7", sourceSha: "7".repeat(40) },
      }),
    /PLATFORM_SOURCE_SHA is required for local image identity/u,
  );
});
