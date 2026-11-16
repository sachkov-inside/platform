// @ts-check
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { scenarioRoles } from "../scenarios/roles.mjs";
import {
  fullStackOfflineServices,
  fullStackReleaseEnvironment,
} from "./full-stack-environment.mjs";

/**
 * A light instance is one worktree's web and API (and MCP when asked) running on the host against
 * the shared stand infrastructure. It owns its processes, its loopback ports and one database,
 * `inside_light_<id>`, in the stand PostgreSQL; teardown removes exactly these.
 */

/** How long `up` lets the supervisor migrate, seed, build and start before it gives up. */
export const lightStartupBudgetMilliseconds = 15 * 60_000;

const databasePattern = /^inside_light_[0-9a-f]{10}$/u;

/** @param {string} worktree the real path of the worktree */
export function lightInstanceName(worktree) {
  const id = createHash("sha256").update(worktree).digest("hex").slice(0, 10);
  return {
    id,
    database: `inside_light_${id}`,
    appId: `inside-web-light-${id}`,
  };
}

/**
 * Accepts only a light instance database, so a wrong argument can never drop the stand's own
 * `inside` or the checks' `inside_checks`.
 * @param {string} database
 */
export function assertLightDatabase(database) {
  if (!databasePattern.test(database))
    throw new Error(`${database} is not a light instance database`);
  return database;
}

export const lightStateSchema = z.strictObject({
  version: z.literal(1),
  id: z.string(),
  worktree: z.string(),
  pid: z.number().int().positive(),
  phase: z.enum(["starting", "ready", "failed", "stopping"]),
  web: z.enum(["production", "development"]),
  startedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
  database: z.string().regex(databasePattern),
  composeProject: z.string(),
  urls: z.strictObject({
    web: z.url(),
    api: z.url(),
    mcp: z.url().nullable(),
    signIn: z.url().nullable(),
  }),
  failure: z.string().nullable(),
});

/** @typedef {z.infer<typeof lightStateSchema>} LightState */

/** @param {string} standDirectory the stand state directory under the Git common directory */
export function lightDirectory(standDirectory) {
  return join(standDirectory, "light");
}

/** @param {string} directory @param {string} id */
export async function readLightState(directory, id) {
  try {
    return lightStateSchema.parse(
      JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw new Error(`Light instance state ${id} is invalid`, { cause: error });
  }
}

/** @param {string} directory */
export async function listLightStates(directory) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  /** @type {LightState[]} */
  const states = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const state = await readLightState(directory, name.slice(0, -5));
    if (state) states.push(state);
  }
  return states;
}

/**
 * Environment of the instance's processes: the checked-in `.env.example` values, as in CI, then
 * the caller's environment, then the instance's own database, ports and sign-in.
 *
 * @param {object} input
 * @param {string} input.database
 * @param {number} input.postgresPort
 * @param {{ web: number; api: number; mcp: number | undefined }} input.ports
 * @param {Record<string, string>} input.identity environment of the synthetic sign-in
 * @param {NodeJS.Dict<string>} input.defaults values of `.env.example`
 * @param {NodeJS.ProcessEnv} input.base the caller's environment
 * @param {"production" | "development"} input.webMode a production build (`next start`) or
 *   `next dev`; the production build names the object storage origin in its CSP (ADR 0028)
 */
export function lightEnvironment({
  database,
  postgresPort,
  ports,
  identity,
  defaults,
  base,
  webMode,
}) {
  const web = `http://127.0.0.1:${String(ports.web)}`;
  const api = `http://127.0.0.1:${String(ports.api)}`;
  const mcp =
    ports.mcp === undefined
      ? undefined
      : `http://127.0.0.1:${String(ports.mcp)}/mcp`;
  /** @type {NodeJS.ProcessEnv} */
  const shared = {
    ...Object.fromEntries(
      Object.entries({ ...defaults, ...base }).filter(
        ([key]) =>
          !key.startsWith("COMPOSE_") &&
          !key.startsWith("LOGTO_") &&
          !key.startsWith("OWNER_LOGTO_") &&
          key !== "DATABASE_URL",
      ),
    ),
    NODE_ENV: "development",
    DATABASE_URL: `postgresql://inside:inside@127.0.0.1:${String(postgresPort)}/${assertLightDatabase(database)}`,
    API_HOST: "127.0.0.1",
    API_PORT: String(ports.api),
    BACKEND_BASE_URL: api,
    PUBLIC_SITE_ORIGIN: web,
    ...fullStackOfflineServices,
    KINESCOPE_PROVIDER_MODE: "test",
    LOCAL_SEED_DEMO: "published",
    ...fullStackReleaseEnvironment,
    OWNER_PERMISSION: "platform:admin",
    NEXT_TELEMETRY_DISABLED: "1",
    HIDE_DEV_INDICATOR: "true",
    ...identity,
  };
  const storageEndpoint =
    shared["OBJECT_STORAGE_SIGNED_GET_ENDPOINT"]?.trim() ||
    shared["OBJECT_STORAGE_ENDPOINT"]?.trim();
  if (!storageEndpoint)
    throw new Error("The light instance needs the object storage endpoint");
  const storage = new URL(storageEndpoint).origin;
  return {
    urls: { web, api, mcp },
    shared,
    web:
      webMode === "production"
        ? {
            ...shared,
            NODE_ENV: "production",
            CSP_LOCAL_OBJECT_STORAGE_ORIGIN: storage,
          }
        : shared,
    mcp:
      mcp === undefined || ports.mcp === undefined
        ? undefined
        : {
            ...shared,
            MCP_HOST: "127.0.0.1",
            MCP_PORT: String(ports.mcp),
            MCP_SERVER_URL: mcp,
          },
  };
}

/**
 * The roles a browser can sign in as, with names nobody bears, so a screenshot shows no real
 * person. The product has one permission, `platform:admin`: the owner is also the author. The
 * holder stands for a buyer after the purchase: payments do not run here, so the owner's grant
 * gives the product with the closed material of the seed. The runbook's light instance section
 * lists the roles for people; the `verify-platform` skill says which role suits which scenario.
 */
export const lightRoles = scenarioRoles;

/** Every key of `lightRoles`, in order; a test keeps the two together. */
export const lightRoleNames = /** @type {const} */ ([
  "owner",
  "holder",
  "learner",
  "newcomer",
]);

/** @typedef {keyof typeof lightRoles} LightRole */

/** @param {string} role @returns {role is LightRole} */
export function isLightRole(role) {
  return Object.hasOwn(lightRoles, role);
}

const accountSchema = z.object({
  account: z.object({ accountId: z.string() }),
});
const termsSchema = z.object({
  document: z.object({ version: z.string(), digest: z.string() }),
});

/**
 * Establishes the role Accounts through the API a signed-in person uses: the learner and the
 * other roles sign in without the web callback that creates an Account on first sign-in. A name needs
 * accepted terms, so the named roles accept the current edition; the acceptance lives in the
 * instance's disposable database.
 *
 * @param {object} input
 * @param {string} input.api the API address
 * @param {(subject?: string) => Promise<{ token: string; expiresAt: number }>} input.createAccessToken
 * @param {(url: string, init: { method: string; headers: { authorization: string; "content-type"?: string }; body?: string }) => Promise<Response>} [input.request]
 * @param {() => string} [input.operationId]
 */
export async function seedLightRoles({
  api,
  createAccessToken,
  request = (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
  operationId = randomUUID,
}) {
  /**
   * @param {LightRole} role @param {"GET" | "POST"} method @param {string} path
   * @param {unknown} [body]
   */
  const call = async (role, method, path, body) => {
    const { token } = await createAccessToken(lightRoles[role].subject);
    const response = await request(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `${method} ${path} for ${role} returned HTTP ${String(response.status)}`,
      );
    }
    return response;
  };
  const holder = accountSchema.parse(
    await (await call("holder", "POST", "/accounts")).json(),
  ).account.accountId;
  for (const role of /** @type {const} */ (["learner", "newcomer"]))
    await (await call(role, "POST", "/accounts")).body?.cancel();
  for (const role of lightRoleNames) {
    const { name } = lightRoles[role];
    if (name === null) continue;
    const terms = "/accounts/current/legal-acceptances/terms";
    const { document } = termsSchema.parse(
      await (await call(role, "GET", terms)).json(),
    );
    await (
      await call(role, "POST", terms, {
        operationId: operationId(),
        version: document.version,
        digest: document.digest,
        buttonLabel: "Light instance role setup",
      })
    ).body?.cancel();
    await (
      await call(role, "POST", "/account/profile", { displayName: name })
    ).body?.cancel();
  }
  await (
    await call("owner", "POST", "/admin/access/products/issue", {
      accountId: holder,
      productId: lightRoles.holder.productId,
      reason: "Тестовый набор ролей лёгкого экземпляра",
      sourceRef: "stand-light:holder",
    })
  ).body?.cancel();
}

/**
 * Signs a browser in with the synthetic identity: `GET /sign-in?as=<role>&next=/path`
 * sets the session cookie and opens the path on web. Cookies of `127.0.0.1` ignore the port, so
 * the cookie set here reaches web. `GET /sign-out` removes it.
 *
 * @param {{ cookieName: string; createAccessToken: (subject?: string) => Promise<{ token: string; expiresAt: number }>; createSession: (session: { token: string; expiresAt: number; subject?: string }) => Promise<string> }} identity
 * @param {string} webBaseUrl
 */
export function lightSignInHandler(identity, webBaseUrl) {
  /**
   * @param {string} method
   * @param {string} url
   * @returns {Promise<{ status: number; headers: Record<string, string> }>}
   */
  return async (method, url) => {
    const parsed = new URL(url, "http://127.0.0.1");
    const next = parsed.searchParams.get("next") ?? "/";
    // Only a path of this web: `//host` or `/\host` would leave it.
    if (method !== "GET" || !/^\/(?![/\\])/u.test(next))
      return { status: 400, headers: {} };
    const location = new URL(next, webBaseUrl).href;
    if (parsed.pathname === "/sign-out")
      return {
        status: 302,
        headers: {
          location,
          "set-cookie": `${identity.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
      };
    const role = parsed.searchParams.get("as") ?? "owner";
    if (parsed.pathname !== "/sign-in" || !isLightRole(role))
      return { status: 404, headers: {} };
    const subject = lightRoles[role].subject;
    const access = await identity.createAccessToken(subject);
    const cookie = await identity.createSession({ ...access, subject });
    return {
      status: 302,
      headers: {
        location,
        "set-cookie": `${identity.cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Lax`,
      },
    };
  };
}

/**
 * Resident memory of a process and all its descendants, in KiB.
 * @param {{ pid: number; ppid: number; rss: number }[]} table @param {number} root
 */
export function treeResidentKiB(table, root) {
  let total = 0;
  const pending = [root];
  const seen = new Set();
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    for (const row of table) {
      if (row.pid === pid) total += row.rss;
      if (row.ppid === pid) pending.push(row.pid);
    }
  }
  return total;
}
