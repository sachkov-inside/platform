// @ts-check
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { createServer, get } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sample, schedule, serve } from "./client.mjs";

const PUBLIC = {
  items: [],
  productSlugs: [],
  topicSlugs: [],
  nextCursor: null,
};
const BODY = { account: { id: "00000000-0000-4000-8000-000000001566" } };

// deterministic-test-allow unit-io: bounded actual owned loopback requests verify complete success, oversize and absolute slow-drip timeout; finally closes sockets/server.
test("resource HTTP samples preserve failures and stop slow body progress by absolute deadline", async () => {
  let mode = "ok";
  const server = createServer((req, res) => {
    if (mode === "drip") {
      res.writeHead(200);
      res.write("{");
      const drip = setInterval(() => res.write(" "), 10);
      res.once("close", () => clearInterval(drip));
      return;
    }
    if (mode === "oversize") {
      res.end("X".repeat(65_537));
      return;
    }
    if (mode === "error") {
      res.writeHead(503);
      res.end("private-provider-sentinel");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/library/site-index" ? PUBLIC : BODY));
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = { host: "127.0.0.1", port: address.port, timeoutMs: 100 };
  try {
    assert.equal(
      (await sample(0, "private-token", false, endpoint)).outcome,
      "ok",
    );
    assert.equal(
      (await sample(1, "private-token", false, endpoint)).outcome,
      "ok",
    );
    mode = "error";
    const failed = await sample(0, "private-token", false, endpoint);
    assert.equal(failed.outcome, "unexpected_response");
    assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(failed), /private/u);
    mode = "oversize";
    assert.equal(
      (await sample(0, "private-token", false, endpoint)).outcome,
      "oversize",
    );
    mode = "drip";
    const started = performance.now();
    const timed = await sample(0, "private-token", false, endpoint);
    assert.equal(timed.outcome, "timeout");
    assert.ok(performance.now() - started < 1000);
    mode = "ok";
    assert.equal(
      (await sample(0, "private-token", false, endpoint)).outcome,
      "ok",
    );
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
});

test("fixed resource schedule owns duration and marks missed slots without catch-up bursts", async () => {
  let now = 0;
  const seen = [];
  const clock = {
    now: () => now,
    wait: async (/** @type {number} */ ms) => {
      now += ms;
    },
  };
  const elapsed = await schedule(
    20,
    async (operation) => ({
      label: operation === 0 ? "public_index" : "protected_account",
      outcome: "ok",
      status: 200,
      elapsed_ms: 1,
    }),
    (_index, value) => seen.push(value),
    clock,
  );
  assert.equal(elapsed, 2);
  assert.equal(seen.length, 20);
  now = 0;
  /** @type {import("./client.mjs").Sample[]} */
  const slow = [];
  await schedule(
    4,
    async () => {
      now += 250;
      return {
        label: "public_index",
        outcome: "timeout",
        status: null,
        elapsed_ms: 250,
      };
    },
    (_index, value) => slow.push(value),
    clock,
  );
  assert.ok(slow.some((value) => value.outcome === "schedule_missed"));
});

// deterministic-test-allow unit-io: private temporary token plus owned ephemeral JWKS server; close awaited and files removed on every outcome.
test("private resource identity signs real ES384 tokens with the existing five-minute lifetime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inside-resource-identity-"));
  const filename = join(directory, "token.json");
  const handle = await serve(filename, { host: "127.0.0.1", port: 0 });
  try {
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    /** @type {unknown} */ const encoded = JSON.parse(
      await readFile(filename, "utf8"),
    );
    assert.ok(
      typeof encoded === "object" &&
        encoded !== null &&
        "token" in encoded &&
        typeof encoded.token === "string",
    );
    const pieces = encoded.token.split(".");
    const header = pieces[0];
    const payload = pieces[1];
    const signature = pieces[2];
    assert.ok(header && payload && signature);
    /** @type {unknown} */ const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    assert.ok(
      typeof claims === "object" &&
        claims !== null &&
        "exp" in claims &&
        "iat" in claims &&
        typeof claims.exp === "number" &&
        typeof claims.iat === "number",
    );
    assert.equal(claims.exp - claims.iat, 300);
    const address = handle.server.address();
    assert.ok(address && typeof address !== "string");
    /** @type {Promise<string>} */
    const response = new Promise((resolve, reject) => {
      const req = get(
        { host: "127.0.0.1", port: address.port, path: "/oidc/jwks" },
        (res) => {
          let value = "";
          res.setEncoding("utf8");
          res.on("data", (/** @type {string} */ part) => {
            value += part;
          });
          res.on("end", () => resolve(value));
        },
      );
      req.on("error", reject);
      req.setTimeout(1000, () => req.destroy());
    });
    const body = await response;
    /** @type {unknown} */ const jwks = JSON.parse(body);
    assert.ok(
      typeof jwks === "object" &&
        jwks !== null &&
        "keys" in jwks &&
        Array.isArray(jwks.keys),
    );
    /** @type {unknown} */
    const rawKey = jwks.keys[0];
    assert.ok(
      typeof rawKey === "object" &&
        rawKey !== null &&
        "kty" in rawKey &&
        typeof rawKey.kty === "string" &&
        "x" in rawKey &&
        typeof rawKey.x === "string" &&
        "y" in rawKey &&
        typeof rawKey.y === "string" &&
        "crv" in rawKey &&
        typeof rawKey.crv === "string",
    );
    const key = { kty: rawKey.kty, x: rawKey.x, y: rawKey.y, crv: rawKey.crv };
    assert.ok(
      verify(
        "sha384",
        Buffer.from(header + "." + payload),
        {
          key: createPublicKey({ key, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature, "base64url"),
      ),
    );
    assert.doesNotMatch(String(body), /private|inside_verified_email|token/u);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
});
