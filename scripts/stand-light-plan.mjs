// @ts-check
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * A light instance is one worktree's web and API (and MCP when asked) running on the host against
 * the shared stand infrastructure. It owns its processes, its loopback ports and one database,
 * `inside_light_<id>`, in the stand PostgreSQL; teardown removes exactly these.
 */

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
 */
export function lightEnvironment({
  database,
  postgresPort,
  ports,
  identity,
  defaults,
  base,
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
    // The seed sells the guide; API refuses a sale without the bank and the receipt mail. Like the
    // full-stack run, the instance buys nothing: the bank is unreachable and mail stays local.
    TBANK_PROVIDER_MODE: "test",
    TBANK_TEST_API_BASE_URL: "http://127.0.0.1:9/v2",
    BILLING_CONTACT_ENCRYPTION_KEY:
      "aW5zaWRlLWxvY2FsLWJpbGxpbmctY29udGFjdC1rZXk=",
    BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
    BILLING_CONTACT_SMTP_PORT: "9",
    BILLING_CONTACT_FROM: "no-reply@inside.localhost",
    BILLING_CONTACT_SMTP_LOCAL_CAPTURE: "true",
    KINESCOPE_PROVIDER_MODE: "test",
    LOCAL_SEED_DEMO: "published",
    PLATFORM_RELEASE_VERSION: "v1",
    PLATFORM_SOURCE_SHA: "1".repeat(40),
    OWNER_PERMISSION: "platform:admin",
    NEXT_TELEMETRY_DISABLED: "1",
    HIDE_DEV_INDICATOR: "true",
    ...identity,
  };
  return {
    urls: { web, api, mcp },
    shared,
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

/** Subjects a browser can sign in as. The owner has `platform:admin`; the learner has no rights. */
export const lightSubjects = {
  owner: "fullstack-owner",
  learner: "light-learner",
};

/**
 * Signs a browser in with the synthetic identity: `GET /sign-in?as=owner|learner&next=/path`
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
    if (
      parsed.pathname !== "/sign-in" ||
      !(role === "owner" || role === "learner")
    )
      return { status: 404, headers: {} };
    const subject = lightSubjects[role];
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
