import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";
import { describe, it } from "node:test";

describe("standalone runtime configuration check", () => {
  it("reports the application diagnostic while port 3000 is occupied", async () => {
    const portOwner = await occupyDefaultPortIfAvailable();

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/check-standalone-runtime-config.mjs"],
        {
          encoding: "utf8",
          env: { ...process.env, PORT: "3000" },
          timeout: 15_000,
        },
      );
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

      assert.ifError(result.error);
      assert.equal(result.status, 0, output);
      assert.match(
        output,
        /Standalone server rejected incomplete production config before readiness\./u,
      );
      if (portOwner !== undefined) {
        assert.equal(portOwner.listening, true);
      }
    } finally {
      if (portOwner !== undefined) {
        await closeServer(portOwner);
      }
    }
  });
});

function occupyDefaultPortIfAvailable() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(undefined);
      } else {
        reject(error);
      }
    });
    server.listen(3000, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
