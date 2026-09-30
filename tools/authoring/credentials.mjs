// @ts-check
// The owner's Logto session for a trusted authoring target (#805). One browser sign-in stores a
// refresh token in the macOS Keychain; every run exchanges it for a short API access token. No
// secret enters Git, command arguments, the journal, previews or reports.
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { z } from "zod";
import { loginHint } from "./target.mjs";

const execute = promisify(execFile);
// The loopback redirect registered for the native Logto application.
export const loginPort = 47823;
const loginTimeoutMinutes = 5;
const loginTimeoutMs = loginTimeoutMinutes * 60_000;
const discoveryTimeoutMs = 10_000;
const tokenRequestTimeoutMs = 15_000;
const millisecondsPerSecond = 1000;
// A token is renewed this long before it expires; Platform accepts tokens of at most five minutes.
const renewalMarginMs = 30_000;
// Logto issues opaque URL-safe tokens and identifiers; anything else never reaches the Keychain.
const storable = /^[A-Za-z0-9._~:-]{1,4096}$/u;

/**
 * @typedef {import("./target.mjs").TrustedTarget} TrustedTarget
 * @typedef {object} SecretStore
 * @property {(account: string) => Promise<string | null>} read
 * @property {(account: string, secret: string) => Promise<void>} write
 * @property {(account: string) => Promise<void>} remove
 * @typedef {{ clientId: string; scope?: string | undefined }} ClientSettings
 */

const discoverySchema = z
  .object({
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
  })
  .passthrough();
const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().optional(),
  })
  .passthrough();
const settingsSchema = z
  .object({ clientId: z.string().min(1), scope: z.string().optional() })
  .strict();

/**
 * The macOS Keychain. A secret is written through `security -i` on standard input, so it never
 * appears in a process argument list.
 *
 * @param {string} [service]
 * @returns {SecretStore}
 */
export function keychainStore(service = "inside-authoring") {
  if (!storable.test(service))
    throw new Error("Refusing an unexpected Keychain service name");
  return {
    async read(account) {
      try {
        const { stdout } = await execute("security", [
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ]);
        return stdout.trim() || null;
      } catch (error) {
        // 44: the item does not exist.
        if (error instanceof Error && "code" in error && error.code === 44)
          return null;
        throw error;
      }
    },
    async write(account, secret) {
      if (!storable.test(secret) || !storable.test(account))
        throw new Error("Refusing to store an unexpected credential shape");
      await new Promise((resolve, reject) => {
        const child = spawn("security", ["-i"], {
          stdio: ["pipe", "ignore", "pipe"],
        });
        let failure = "";
        child.stderr.on("data", (chunk) => {
          failure += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 && failure === ""
            ? resolve(undefined)
            : reject(new Error(`Keychain write failed (${String(code)})`)),
        );
        child.stdin.end(
          `add-generic-password -U -s "${service}" -a "${account}" -w "${secret}"\n`,
        );
      });
    },
    async remove(account) {
      try {
        await execute("security", [
          "delete-generic-password",
          "-s",
          service,
          "-a",
          account,
        ]);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === 44))
          throw error;
      }
    },
  };
}

/** @param {Buffer} bytes */
const base64url = (bytes) => bytes.toString("base64url");

/** @param {TrustedTarget} target */
const accounts = (target) => ({
  refresh: `${target.name}:refresh-token`,
  settings: `${target.name}:client`,
});

/**
 * @param {TrustedTarget} target
 * @param {typeof fetch} fetcher
 */
async function discover(target, fetcher) {
  const response = await fetcher(
    `${target.issuer}/.well-known/openid-configuration`,
    { redirect: "error", signal: AbortSignal.timeout(discoveryTimeoutMs) },
  );
  if (!response.ok)
    throw new Error(`Sign-in discovery failed: ${String(response.status)}`);
  return discoverySchema.parse(await response.json());
}

/**
 * Token endpoint call; its error names only the status and OAuth error code, never a token.
 *
 * @param {typeof fetch} fetcher
 * @param {string} endpoint
 * @param {Record<string, string>} fields
 */
async function requestToken(fetcher, endpoint, fields) {
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(tokenRequestTimeoutMs),
  });
  const body = /** @type {unknown} */ (await response.json().catch(() => null));
  if (!response.ok) {
    const code = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      `Sign-in token request failed: ${String(response.status)} ${code.success ? code.data.error : ""}`.trim(),
    );
  }
  return tokenSchema.parse(body);
}

/**
 * One browser sign-in: authorization code with PKCE and a loopback redirect. The refresh token and
 * the client settings go to the store; the access token is not kept.
 *
 * @param {TrustedTarget} target
 * @param {ClientSettings & {
 *   store: SecretStore;
 *   fetcher?: typeof fetch;
 *   openUrl?: (url: string) => void | Promise<void>;
 *   port?: number;
 * }} options
 */
export async function login(
  target,
  {
    clientId,
    scope,
    store,
    fetcher = fetch,
    openUrl = (url) => void spawn("open", [url], { stdio: "ignore" }).unref(),
    port = loginPort,
  },
) {
  const settings = settingsSchema.parse({ clientId, scope });
  const endpoints = await discover(target, fetcher);
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  /** @type {(value: string) => void} */
  let deliver = () => {};
  /** @type {(error: Error) => void} */
  let fail = () => {};
  /** @type {Promise<string>} */
  const code = new Promise((resolve, reject) => {
    deliver = resolve;
    fail = reject;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    // Another local process cannot end this sign-in: a callback for another request is ignored.
    if (url.searchParams.get("state") !== state) {
      response.writeHead(400).end();
      return;
    }
    const received = url.searchParams.get("code");
    // The refusal code is an OAuth error name; anything else is not repeated back.
    const refusal = /^[a-z_]{1,64}$/u.exec(
      url.searchParams.get("error") ?? "",
    )?.[0];
    response
      .writeHead(received === null ? 400 : 200, {
        "content-type": "text/plain; charset=utf-8",
      })
      .end(
        received === null
          ? "Вход не выполнен. Запустите вход заново."
          : "Вход выполнен. Вернитесь в терминал.",
      );
    if (received !== null) deliver(received);
    else fail(new Error(`Sign-in was refused: ${refusal ?? "no code"}`));
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        new Error(
          `Sign-in callback port ${String(port)} is busy; close the other sign-in and retry`,
          { cause: error },
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : port)}/callback`;
  try {
    const authorize = new URL(endpoints.authorization_endpoint);
    for (const [name, value] of Object.entries({
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      // offline_access with consent is what makes Logto issue a refresh token.
      scope: ["openid", "offline_access", settings.scope ?? ""]
        .join(" ")
        .trim(),
      prompt: "consent",
      resource: target.resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }))
      authorize.searchParams.set(name, value);
    await openUrl(authorize.toString());
    const timeout = setTimeout(
      () =>
        fail(
          new Error(
            `Sign-in was not completed in ${String(loginTimeoutMinutes)} minutes`,
          ),
        ),
      loginTimeoutMs,
    );
    let received;
    try {
      received = await code;
    } finally {
      clearTimeout(timeout);
    }
    const token = await requestToken(fetcher, endpoints.token_endpoint, {
      grant_type: "authorization_code",
      code: received,
      redirect_uri: redirectUri,
      client_id: settings.clientId,
      code_verifier: verifier,
      resource: target.resource,
    });
    if (token.refresh_token === undefined)
      throw new Error(
        "Logto issued no refresh token; enable refresh tokens for this application",
      );
    await store.write(accounts(target).refresh, token.refresh_token);
    await store.write(
      accounts(target).settings,
      Buffer.from(JSON.stringify(settings)).toString("base64url"),
    );
  } finally {
    server.close();
  }
}

/**
 * @param {TrustedTarget} target
 * @param {SecretStore} store
 */
export async function logout(target, store) {
  await store.remove(accounts(target).refresh);
  await store.remove(accounts(target).settings);
}

/**
 * A fresh API access token for every request, renewed from the stored refresh token. A rotated
 * refresh token replaces the stored one before the access token is used.
 *
 * @param {TrustedTarget} target
 * @param {{ store: SecretStore; fetcher?: typeof fetch; now?: () => number }} options
 * @returns {import("./target.mjs").AccessToken}
 */
export function ownerSession(
  target,
  { store, fetcher = fetch, now = Date.now },
) {
  /** @type {{ token: string; expiresAt: number } | undefined} */
  let cached;
  /** @type {Promise<string> | undefined} */
  let renewing;
  const renew = async () => {
    const [refresh, encoded] = await Promise.all([
      store.read(accounts(target).refresh),
      store.read(accounts(target).settings),
    ]);
    if (refresh === null || encoded === null)
      throw new Error(
        `No owner session for ${target.name}: ${loginHint(target)}`,
      );
    const settings = settingsSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    const endpoints = await discover(target, fetcher);
    const token = await requestToken(fetcher, endpoints.token_endpoint, {
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: settings.clientId,
      resource: target.resource,
      ...(settings.scope ? { scope: settings.scope } : {}),
    });
    if (token.refresh_token !== undefined && token.refresh_token !== refresh)
      await store.write(accounts(target).refresh, token.refresh_token);
    cached = {
      token: token.access_token,
      expiresAt: now() + token.expires_in * millisecondsPerSecond,
    };
    return token.access_token;
  };
  return async () => {
    if (cached !== undefined && now() < cached.expiresAt - renewalMarginMs)
      return cached.token;
    // Concurrent requests share one renewal, so a rotated refresh token is used once.
    renewing ??= renew().finally(() => {
      renewing = undefined;
    });
    return renewing;
  };
}
