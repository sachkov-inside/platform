// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { login, logout, ownerSession } from "./credentials.mjs";
import { trustedTarget } from "./target.mjs";

const target = trustedTarget("production");
const discovery = `${target.issuer}/.well-known/openid-configuration`;
const tokenEndpoint = `${target.issuer}/token`;

/** An in-memory Keychain double; it records every write. */
function memoryStore() {
  /** @type {Map<string, string>} */
  const items = new Map();
  /** @type {string[]} */
  const writes = [];
  return {
    items,
    writes,
    /** @param {string} account */
    read: async (account) => items.get(account) ?? null,
    /** @param {string} account @param {string} secret */
    write: async (account, secret) => {
      writes.push(account);
      items.set(account, secret);
    },
    /** @param {string} account */
    remove: async (account) => {
      items.delete(account);
    },
  };
}

/**
 * A Logto double: discovery, and a token endpoint that checks PKCE, the resource and the refresh
 * token it issued last, rotating it on every refresh.
 */
function logto() {
  /** @type {Map<string, string>} */
  const challenges = new Map();
  let issued = 0;
  let current = "refresh-0";
  /** @type {URLSearchParams[]} */
  const tokenRequests = [];
  /** @type {typeof fetch} */
  const fetcher = async (input, init) => {
    const url = String(input);
    if (url === discovery)
      return Response.json({
        authorization_endpoint: `${target.issuer}/auth`,
        token_endpoint: tokenEndpoint,
      });
    if (url !== tokenEndpoint) throw new Error(`Unexpected ${url}`);
    const form = new URLSearchParams(String(init?.body));
    tokenRequests.push(form);
    assert.equal(form.get("resource"), target.resource);
    assert.equal(form.get("client_id"), "native-client");
    if (form.get("grant_type") === "authorization_code") {
      const expected = challenges.get(form.get("code") ?? "");
      const actual = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      if (expected !== actual)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
    } else if (form.get("refresh_token") !== current) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    issued++;
    current = `refresh-${String(issued)}`;
    return Response.json({
      access_token: `access-${String(issued)}`,
      expires_in: 300,
      refresh_token: current,
    });
  };
  return {
    fetcher,
    tokenRequests,
    /** The browser: the owner signs in and Logto redirects back with a code. */
    /** @param {string} value @param {{ state?: string }} [override] */
    async openUrl(value, override = {}) {
      const url = new URL(value);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(url.searchParams.get("prompt"), "consent");
      assert.equal(url.searchParams.get("resource"), target.resource);
      assert.match(url.searchParams.get("scope") ?? "", /offline_access/u);
      const code = `code-${String(challenges.size)}`;
      challenges.set(code, url.searchParams.get("code_challenge") ?? "");
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      assert.equal(redirect.hostname, "127.0.0.1");
      redirect.searchParams.set("code", code);
      redirect.searchParams.set(
        "state",
        override.state ?? url.searchParams.get("state") ?? "",
      );
      // The real browser follows the redirect after the page opens.
      setImmediate(() => void fetch(redirect).catch(() => {}));
    },
  };
}

test("one browser sign-in stores only the refresh token and client settings", async () => {
  const store = memoryStore();
  const server = logto();
  await login(target, {
    clientId: "native-client",
    store,
    fetcher: server.fetcher,
    openUrl: (url) => server.openUrl(url),
    port: 0,
  });
  assert.deepEqual([...store.items.keys()].sort(), [
    "production:client",
    "production:refresh-token",
  ]);
  assert.equal(store.items.get("production:refresh-token"), "refresh-1");
  assert.ok(
    ![...store.items.values()].some((value) => value.startsWith("access-")),
  );

  await logout(target, store);
  assert.equal(store.items.size, 0);
});

test("a foreign callback cannot end a sign-in, and a refusal in Logto is reported", async () => {
  const store = memoryStore();
  const server = logto();
  /** @type {number[]} */
  const foreign = [];
  await login(target, {
    clientId: "native-client",
    store,
    fetcher: server.fetcher,
    openUrl: async (value) => {
      const url = new URL(value);
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("code", "stolen");
      redirect.searchParams.set("state", "forged");
      foreign.push((await fetch(redirect)).status);
      await server.openUrl(value);
    },
    port: 0,
  });
  assert.deepEqual(foreign, [400]);
  assert.equal(store.items.get("production:refresh-token"), "refresh-1");

  const refused = memoryStore();
  await assert.rejects(
    login(target, {
      clientId: "native-client",
      store: refused,
      fetcher: server.fetcher,
      openUrl: (value) => {
        const url = new URL(value);
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
        setImmediate(() => void fetch(redirect).catch(() => {}));
      },
      port: 0,
    }),
    /Sign-in was refused: access_denied/u,
  );
  assert.equal(refused.items.size, 0);
});

test("the session renews short tokens once, keeps the rotated refresh token and names no secret on failure", async () => {
  const store = memoryStore();
  const server = logto();
  await login(target, {
    clientId: "native-client",
    store,
    fetcher: server.fetcher,
    openUrl: (url) => server.openUrl(url),
    port: 0,
  });
  let now = 1_000_000;
  const session = ownerSession(target, {
    store,
    fetcher: server.fetcher,
    now: () => now,
  });
  // Concurrent requests share one renewal.
  const [first, second] = await Promise.all([session(), session()]);
  assert.equal(first, "access-2");
  assert.equal(second, "access-2");
  assert.equal(store.items.get("production:refresh-token"), "refresh-2");
  now += 200_000;
  assert.equal(await session(), "access-2");
  now += 90_000;
  assert.equal(await session(), "access-3");
  assert.equal(server.tokenRequests.length, 3);

  // A revoked refresh token fails with the status and OAuth code only.
  store.items.set("production:refresh-token", "revoked");
  now += 400_000;
  await assert.rejects(session(), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /400 invalid_grant/u);
    assert.doesNotMatch(error.message, /revoked|refresh-|access-/u);
    return true;
  });
});

test("without a stored session the tool asks for the one-time sign-in", async () => {
  const session = ownerSession(target, {
    store: memoryStore(),
    fetcher: logto().fetcher,
  });
  await assert.rejects(
    session(),
    /run pnpm authoring:login --target production --client-id CLIENT_ID/u,
  );
});
