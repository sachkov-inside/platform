// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { createStandRuntime } from "./stand-runtime.mjs";

test("runtime discovery rejects a remote Docker endpoint before inspecting or changing containers", async () => {
  /** @type {string[][]} */
  const calls = [];
  const runtime = createStandRuntime({
    root: "/fixture",
    directory: "/fixture/state",
    pnpmPath: "/fixture/pnpm",
    run: async (args) => {
      calls.push(args);
      return JSON.stringify("tcp://remote.invalid:2375");
    },
  });
  await assert.rejects(runtime.inspect(), /local Docker/u);
  assert.equal(calls.length, 1);
});

test("runtime discovery reads actual container IDs and immutable images from the fixed project", async () => {
  const runtime = createStandRuntime({
    root: "/fixture",
    directory: "/fixture/state",
    pnpmPath: "/fixture/pnpm",
    run: async (args) => {
      if (args[0] === "context")
        return JSON.stringify("unix:///fixture/docker.sock");
      if (args[0] === "info") return "fixture-daemon";
      if (args[0] === "container") {
        assert.ok(
          args.includes("label=com.docker.compose.project=inside-platform"),
        );
        return "fixture-container";
      }
      if (args[0] === "inspect")
        return JSON.stringify({
          id: "fixture-container",
          image: "sha256:fixture-image",
          service: "web",
          generation: "fixture-generation",
          running: true,
          health: "healthy",
        });
      throw new Error(`Unexpected Docker mutation: ${args[0]}`);
    },
  });
  const snapshot = await runtime.inspect();
  assert.equal(snapshot.daemon, "fixture-daemon");
  assert.equal(snapshot.containers[0]?.image, "sha256:fixture-image");
});
