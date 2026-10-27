// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:https";
import { botProvider } from "./bot-provider.mjs";
// deterministic-test-allow unit-io: task-owned stdlib TLS peer, certificate files and child; no Docker or provider calls.
test("isolated Bot API accepts only synthetic methods under the owned TLS identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inside-bot-peer-"));
  try {
    execFileSync("python3", [
      "-B",
      "-c",
      "import sys,pathlib;sys.path.insert(0,'scripts/observability-resource');import fixture;fixture.certificates(pathlib.Path(sys.argv[1]),telegram=True)",
      directory,
    ]);
    const cert = await readFile(join(directory, "provider-tls/server.pem"));
    const server = botProvider({
      key: await readFile(join(directory, "provider-tls/server.key")),
      cert,
    });
    try {
      await new Promise((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve(undefined)),
      );
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("owned port required");
      /** @param {string} path */
      const call = async (path) =>
        await new Promise(
          /** @param {(value:{status:number|undefined,body:unknown})=>void} resolve @param {(reason:unknown)=>void} reject */
          (resolve, reject) => {
            const incoming = request(
              {
                host: "127.0.0.1",
                port: address.port,
                path,
                method: "POST",
                servername: "api.telegram.org",
                ca: cert,
                timeout: 2000,
              },
              (response) => {
                /** @type {Buffer[]} */ const data = [];
                response.on("data", (/** @type {unknown} */ part) => {
                  if (Buffer.isBuffer(part)) data.push(part);
                });
                response.on("end", () =>
                  resolve({
                    status: response.statusCode,
                    body: /** @type {unknown} */ (
                      JSON.parse(Buffer.concat(data).toString("utf8"))
                    ),
                  }),
                );
              },
            );
            incoming.on("error", reject);
            incoming.on("timeout", () =>
              incoming.destroy(new Error("owned deadline")),
            );
            incoming.end("{}");
          },
        );
      assert.deepEqual(await call("/bot1566:synthetic/getMe"), {
        status: 200,
        body: {
          ok: true,
          result: {
            id: 1566,
            is_bot: true,
            first_name: "synthetic",
            username: "inside_fixture_bot",
          },
        },
      });
      assert.deepEqual(await call("/bot1566:synthetic/unknown"), {
        status: 403,
        body: { ok: false, error_code: 403 },
      });
      assert.deepEqual(await call("/botother/getMe"), {
        status: 403,
        body: { ok: false, error_code: 403 },
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
