// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { parseEnv } from "node:util";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { parsePlatformConfig } from "../src/config/platform-config.js";
import { createLogtoAccessTokenVerifier } from "../src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.js";
import { accountResponseSchema } from "../src/modules/accounts/adapters/nest/account-http.contract.js";
import {
  sample,
  serve,
} from "../../../scripts/observability-resource/client.mjs";

// deterministic-test-allow unit-io: actual config, remote JWT verifier and account response schema meet the resource client through owned HTTPS/HTTP loopback; all sockets, dispatcher and private files close in finally.
test("resource corpus token and response meet the real application contracts", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "inside-resource-application-"),
  );
  const previous = getGlobalDispatcher();
  /** @type {Awaited<ReturnType<typeof serve>> | undefined} */ let provider;
  /** @type {Agent | undefined} */ let dispatcher;
  const api = createServer();
  try {
    execFileSync(
      "python3",
      [
        "-B",
        "-c",
        "import sys;from pathlib import Path;sys.path.insert(0,'scripts/observability-resource');import fixture;output=Path(sys.argv[1]);fixture.configuration(output,'a'*40);fixture.certificates(output)",
        directory,
      ],
      { timeout: 6000, stdio: "pipe" },
    );
    const environment = parseEnv(
      await readFile(join(directory, "runtime/api.env"), "utf8"),
    );
    const config = parsePlatformConfig(environment);
    assert.equal(config.identity.issuer, "https://identity.resource.test/oidc");
    assert.equal(config.identity.audience, "https://api.resource.test");
    assert.equal(config.identity.jwksUrl, "https://provider:8081/oidc/jwks");
    const certificate = await readFile(join(directory, "trust/provider.pem"));
    const filename = join(directory, "token.json");
    provider = await serve(
      filename,
      { host: "127.0.0.1", port: 0 },
      {
        key: await readFile(join(directory, "provider-tls/server.key")),
        cert: certificate,
      },
    );
    const address = provider.server.address();
    assert.ok(address && typeof address !== "string");
    // Only the ephemeral test address changes. TLS still verifies the fixed provider DNS name and actual generated CA; the application verifier uses its normal remote JWKS/fetch path.
    dispatcher = new Agent({
      connect: { ca: certificate, servername: "provider" },
    });
    setGlobalDispatcher(dispatcher);
    const verifier = createLogtoAccessTokenVerifier({
      issuer: config.identity.issuer,
      audience: config.identity.audience,
      jwksUrl: `https://127.0.0.1:${address.port}/oidc/jwks`,
    });
    /** @type {unknown} */ const encoded = JSON.parse(
      await readFile(filename, "utf8"),
    );
    assert.ok(
      encoded &&
        typeof encoded === "object" &&
        "token" in encoded &&
        typeof encoded.token === "string",
    );
    const bearer = encoded.token;
    assert.equal(
      (await verifier.verifyAccountSignIn(bearer)).ok,
      true,
      "generated sign-in proof accepted",
    );
    assert.equal(
      (await verifier.verifyAccount(bearer)).ok,
      true,
      "generated API proof accepted",
    );
    for (const identity of [
      {
        issuer: config.identity.issuer,
        audience: config.identity.audience + "/api",
      },
      {
        issuer: config.identity.issuer + "/other",
        audience: config.identity.audience,
      },
    ]) {
      const mismatched = createLogtoAccessTokenVerifier({
        ...identity,
        jwksUrl: `https://127.0.0.1:${address.port}/oidc/jwks`,
      });
      assert.deepEqual(await mismatched.verifyAccount(bearer), {
        ok: false,
        error: { code: "invalid_proof" },
      });
    }
    const body = accountResponseSchema.parse({
      account: { accountId: "00000000-0000-4000-8000-000000001566" },
    });
    api.on("request", (req, res) => {
      res.setHeader("content-type", "application/json");
      res.writeHead(req.method === "POST" ? 201 : 200);
      res.end(JSON.stringify(body));
    });
    await new Promise((resolve) =>
      api.listen(0, "127.0.0.1", () => resolve(undefined)),
    );
    const target = api.address();
    assert.ok(target && typeof target !== "string");
    const transport = { host: "127.0.0.1", port: target.port, timeoutMs: 1000 };
    assert.equal(
      (await sample(1, bearer, true, transport)).outcome,
      "ok",
      "real establish response accepted",
    );
    assert.equal(
      (await sample(1, bearer, false, transport)).outcome,
      "ok",
      "real resolve response accepted",
    );
  } finally {
    setGlobalDispatcher(previous);
    await new Promise((resolve) => {
      api.close(() => resolve(undefined));
      api.closeAllConnections();
    });
    await dispatcher?.close();
    await provider?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
