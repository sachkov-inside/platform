// Loopback authoring gateway for the full local stand (`pnpm local:stand`).
// It turns the stand owner's personal access token into short Platform API tokens through the
// stand's own Logto. There is no other trusted issuer and no production mode.
import { Buffer } from "node:buffer";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URLSearchParams } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

import { localTargets } from "../tools/authoring/target.mjs";
import { readIdentityProofPort } from "./identity-proof-environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gateway = new URL(localTargets.stand);
// Refresh an access token this long before it expires.
const tokenRefreshMarginMs = 30_000;
const tokenExchangeTimeoutMs = 10_000;
const millisecondsPerSecond = 1_000;
const patName = "inside-authoring-stand";
const patPath = resolve(root, ".identity-proof/authoring-owner-pat.json");
const exchangeType = "urn:ietf:params:oauth:grant-type:token-exchange";
const patType = "urn:logto:token-type:personal_access_token";

const settingsSchema = z.object({
  LOGTO_ENDPOINT: z.url(),
  LOGTO_AUDIENCE: z.url(),
  AUTHORING_STAND_APP_ID: z.string().min(1),
  AUTHORING_STAND_APP_SECRET: z.string().min(1),
});
const storedPatSchema = z.object({ endpoint: z.string(), email: z.string(), userId: z.string(), value: z.string().min(1) });

// Only authoring API paths reach the stand, and only from non-browser clients on this machine.
// Any local process can act as the stand owner through this gateway; it never serves another host.
export function forwardedPath(host, url, origin, fetchSite) {
  if (host !== gateway.host || origin !== undefined || fetchSite !== undefined) return null;
  if (!url.startsWith("/__local-api/authoring/")) return null;
  const path = url.slice("/__local-api".length);
  const parsed = new URL(path, "http://gateway.invalid");
  const normalized = `${parsed.pathname}${parsed.search}`;
  // Any normalization (dot segments, encoded dots, duplicate slashes) means the request is not canonical.
  if (normalized !== path || !parsed.pathname.startsWith("/authoring/") || /%2e|\/\//iu.test(path)) return null;
  return normalized;
}

export function tokenCache(exchange, now = () => Date.now()) {
  let current;
  return async () => {
    if (current === undefined || current.expiresAt - tokenRefreshMarginMs <= now()) {
      const token = await exchange();
      current = { value: token.access_token, expiresAt: now() + token.expires_in * millisecondsPerSecond };
    }
    return current.value;
  };
}

async function writePrivate(path, value) {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function ownerPersonalAccessToken(settings, email, { renew }) {
  const stored = await readFile(patPath, "utf8").then((text) => storedPatSchema.parse(JSON.parse(text))).catch(() => null);
  if (!renew && stored?.endpoint === settings.LOGTO_ENDPOINT && stored.email === email) return stored.value;
  const bootstrap = await import("./identity-proof-bootstrap.mjs");
  const secret = await bootstrap.retry(() => Promise.resolve(bootstrap.readSeededManagementSecret()));
  const api = bootstrap.createManagementApi(await bootstrap.fetchManagementAccessToken(secret));
  const users = z.array(z.object({ id: z.string(), primaryEmail: z.string().nullable() })).parse(await api(`/users?search=${encodeURIComponent(email)}`));
  const owner = users.filter((user) => user.primaryEmail?.toLowerCase() === email.toLowerCase());
  if (owner.length !== 1) throw new Error(`Sign in to the stand once as ${email} before starting the authoring gateway`);
  const userId = owner[0].id;
  const existing = z.array(z.object({ name: z.string() })).parse(await api(`/users/${userId}/personal-access-tokens`));
  if (existing.some((token) => token.name === patName)) await api(`/users/${userId}/personal-access-tokens/${encodeURIComponent(patName)}`, { method: "DELETE" });
  const created = z.object({ value: z.string().min(1) }).parse(await api(`/users/${userId}/personal-access-tokens`, { method: "POST", body: { name: patName } }));
  await writePrivate(patPath, { endpoint: settings.LOGTO_ENDPOINT, email, userId, value: created.value });
  return created.value;
}

async function main() {
  const { values } = parseArgs({ options: { "owner-email": { type: "string" } } });
  const email = values["owner-email"];
  if (!email) throw new Error("Usage: pnpm authoring:stand-gateway --owner-email OWNER_EMAIL");
  // The bootstrap module reads its stand flag when first imported.
  process.env.LOGTO_ON_STAND = "true";
  const { parseEnv } = await import("./identity-proof-bootstrap.mjs");
  const settings = settingsSchema.parse(parseEnv(await readFile(resolve(root, ".identity-proof/authoring-stand.env"), "utf8").catch(() => {
    throw new Error("Start the stand with pnpm local:stand first: it configures the authoring client");
  })));
  const apiOrigin = `http://127.0.0.1:${String(readIdentityProofPort(process.env, "API_HOST_PORT", 3001))}`;
  const exchange = async (pat) => {
    const response = await fetch(`${settings.LOGTO_ENDPOINT}/oidc/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${settings.AUTHORING_STAND_APP_ID}:${settings.AUTHORING_STAND_APP_SECRET}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: exchangeType, subject_token: pat, subject_token_type: patType, resource: settings.LOGTO_AUDIENCE }),
      signal: AbortSignal.timeout(tokenExchangeTimeoutMs),
    });
    if (!response.ok) return { ok: false, status: response.status, detail: await response.text() };
    return { ok: true, token: z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() }).parse(await response.json()) };
  };
  let pat = await ownerPersonalAccessToken(settings, email, { renew: false });
  let first = await exchange(pat);
  // A stored token dies with a recreated sign-in database; one renewal replaces it.
  if (!first.ok && first.status === 400) {
    pat = await ownerPersonalAccessToken(settings, email, { renew: true });
    first = await exchange(pat);
  }
  if (!first.ok) throw new Error(`Stand token exchange failed: ${String(first.status)} ${first.detail}`);
  let initial = first.token;
  const accessToken = tokenCache(async () => {
    if (initial !== undefined) { const token = initial; initial = undefined; return token; }
    const next = await exchange(pat);
    if (!next.ok) throw new Error(`Stand token exchange failed: ${String(next.status)} ${next.detail}`);
    return next.token;
  });
  const environment = await fetch(`${apiOrigin}/authoring/import/materials/environment`, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!environment.ok) throw new Error(`Stand API refused the owner token (${String(environment.status)}); run the owner bootstrap for ${email}`);
  if (z.object({ mode: z.string() }).parse(await environment.json()).mode !== "development") throw new Error("The authoring gateway serves only a development stand");

  const server = createServer(async (request, response) => {
    const path = forwardedPath(request.headers.host, request.url ?? "", request.headers.origin, request.headers["sec-fetch-site"]);
    if (path === null) { response.writeHead(403).end(); return; }
    try {
      const headers = { authorization: `Bearer ${await accessToken()}` };
      for (const name of ["content-type", "idempotency-key", "accept"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const chunks = [];
      if (hasBody) for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(`${apiOrigin}${path}`, {
        method: request.method, headers, redirect: "error",
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
      });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ title: "Authoring gateway failure", detail: String(error) }));
    }
  });
  server.listen(Number(gateway.port), gateway.hostname, () => {
    process.stdout.write(`Authoring gateway for the stand: ${gateway.origin} (owner ${email}). Stop with Ctrl+C.\n`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.close(() => process.exit(0)); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
