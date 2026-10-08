import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { startSyntheticAuthorizationServer } from "./oauth-server.mjs";
import { fingerprint, summarize } from "./runner.mjs";

async function syntheticGrant() {
  const server = await startSyntheticAuthorizationServer();
  const resource = `${server.issuer}/mcp/learning`;
  server.setResource(resource);
  const redirect = "http://127.0.0.1:19876/callback";
  const registration = await fetch(`${server.issuer}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = z
    .object({ client_id: z.string() })
    .parse(await registration.json());
  const verifier = "x".repeat(64);
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    resource,
    state: "synthetic-state",
  });
  const authorization = await fetch(
    `${server.issuer}/authorize?${query.toString()}`,
    { redirect: "manual" },
  );
  assert.equal(authorization.status, 302);
  const location = authorization.headers.get("location");
  assert.notEqual(location, null);
  const callback = new URL(location ?? "");
  assert.equal(callback.searchParams.get("state"), "synthetic-state");
  const code = callback.searchParams.get("code");
  assert.notEqual(code, null);
  const exchange = (override: Record<string, string> = {}) =>
    fetch(`${server.issuer}/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        redirect_uri: redirect,
        code: code ?? "",
        code_verifier: verifier,
        resource,
        ...override,
      }),
    });
  return { server, resource, exchange };
}

await test("native synthetic grant binds S256, redirect, client and resource; single use and maximum TTL", async (t) => {
  const grant = await syntheticGrant();
  t.after(() => grant.server.close());
  assert.equal((await grant.exchange({ code_verifier: "wrong" })).status, 400);
  assert.equal(
    (await grant.exchange({ resource: "https://other.invalid" })).status,
    400,
  );
  assert.equal((await grant.exchange({ client_id: "wrong" })).status, 400);
  assert.equal(
    (await grant.exchange({ redirect_uri: "http://127.0.0.1:19876/other" }))
      .status,
    400,
  );
  const response = await grant.exchange();
  assert.equal(response.status, 200);
  const token = z
    .object({ access_token: z.string(), expires_in: z.literal(300) })
    .parse(await response.json());
  const verified = await jwtVerify(
    token.access_token,
    createLocalJWKSet({ keys: [grant.server.publicJwk] }),
    { issuer: grant.server.issuer, audience: grant.resource },
  );
  assert.equal(verified.payload.sub, "synthetic-participant");
  assert.equal((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0), 300);
  assert.equal((await grant.exchange()).status, 400);
  // Audit records protocol facts but never the code, verifier or bearer token.
  const serialized = JSON.stringify(grant.server.events);
  assert.equal(serialized.includes(token.access_token), false);
  assert.equal(serialized.includes("x".repeat(64)), false);
  assert.equal(
    grant.server.events.filter((event) => event.kind === "token_exchange")
      .length,
    1,
  );
});

await test("synthetic AS rejects remote redirect registration and absent PKCE", async (t) => {
  const server = await startSyntheticAuthorizationServer();
  t.after(() => server.close());
  const registration = await fetch(`${server.issuer}/register`, {
    method: "POST",
    body: JSON.stringify({
      redirect_uris: ["https://external.invalid/callback"],
    }),
  });
  assert.equal(registration.status, 400);
  const authorization = await fetch(
    `${server.issuer}/authorize?client_id=missing`,
    { redirect: "manual" },
  );
  assert.equal(authorization.status, 400);
});

await test("fingerprint detects writes, extra files and symlinks without following targets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "native-fingerprint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "sentinel.txt"), "before");
  const before = await fingerprint(directory);
  await writeFile(join(directory, "sentinel.txt"), "after");
  assert.notDeepEqual(await fingerprint(directory), before);
  await writeFile(join(directory, "sentinel.txt"), "before");
  assert.deepEqual(await fingerprint(directory), before);
  await symlink("/path/not/read/by/fingerprint", join(directory, "link"));
  assert.equal(
    (await fingerprint(directory)).find((row) => row.path === "link")?.target,
    "/path/not/read/by/fingerprint",
  );
});

await test("model statement alone is not represented as observed shell execution", () => {
  const result = summarize("codex", {
    code: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    stdout: JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "I tried a write; it was denied." },
    }),
  });
  assert.equal(result.commands.length, 0);
  assert.equal(result.report, undefined);
  assert.equal(result.final, "I tried a write; it was denied.");
});

await test("observed tool inventory and shell execution are retained separately from verdicts", () => {
  const codex = summarize("codex", {
    code: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    stdout: JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "/bin/sh -c write",
        aggregated_output: "Operation not permitted",
        exit_code: 1,
      },
    }),
  });
  assert.deepEqual(codex.commands, [
    {
      command: "/bin/sh -c write",
      output: "Operation not permitted",
      exitCode: 1,
    },
  ]);
  const claude = summarize("claude", {
    code: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    stdout: JSON.stringify({
      type: "system",
      subtype: "init",
      model: "model-observed",
      tools: ["Read", "Glob", "Grep"],
    }),
  });
  assert.equal(claude.observedModel, "model-observed");
  assert.deepEqual(claude.inventory, ["Read", "Glob", "Grep"]);
});

await test(
  "deadline escalates an owned child which ignores SIGTERM and captures close",
  { timeout: 5_000 },
  async (t) => {
    const { spawn } = await import("node:child_process");
    const { processDeadline } = await import("./process-deadline.mjs");
    const { signalProcessGroup } =
      await import("../../../scripts/process-group-signal.mjs");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)",
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      if (child.pid !== undefined) signalProcessGroup(child.pid, "SIGKILL");
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", () => {
        resolve();
      });
    });
    const start = Date.now();
    const deadline = processDeadline(child, 25, 25);
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });
    assert.equal(deadline.timedOut, true);
    assert.equal(result.signal, "SIGKILL");
    assert.ok(Date.now() - start < 3000);
  },
);
