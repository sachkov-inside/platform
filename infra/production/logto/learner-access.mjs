// @ts-check
// Learner MCP access in Logto (#938): one owner for the local stand and production.
//
// Every Inside account reads learning materials through any MCP client: a default role carries
// `learning:read`, dynamic apps (CIMD) may request it, and a public Native client serves clients
// without CIMD. ContentAccess still decides which lessons an account may read.
//
// Production runs this file inside the Logto container, so it has no dependencies. The secret of
// the seeded admin Management API client arrives on stdin and stays in memory:
//
//   psql ... | docker exec -i <logto> node /foundation/learner-access.mjs --resource <url> [--check]

import { text } from "node:stream/consumers";

/**
 * @typedef {(path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>} ManagementApi
 * @typedef {{ resource: string }} LearnerAccessTarget
 */

export const learnerAccessSettings = Object.freeze({
  resourceName: "Inside Learner MCP",
  scope: "learning:read",
  scopeDescription:
    "Read Inside learning materials through MCP; access follows ContentAccess",
  roleName: "Inside learner connection",
  legacyRoleNames: [
    "Inside learner connection (author pass)",
    "Inside local learner connection",
  ],
  clientName: "Inside Learner MCP Client",
  legacyClientNames: ["Inside Learner Codex", "Inside Learner Codex Stand"],
  /** Seconds; the Platform verifier rejects longer-lived access tokens. */
  accessTokenTtl: 300,
  /** Loopback hosts accept any port (RFC 8252); the paths are those MCP clients use. */
  redirectUris: ["127.0.0.1", "localhost"].flatMap((host) =>
    ["/callback", "/mcp/oauth/callback"].map((path) => `http://${host}${path}`),
  ),
});

/**
 * Converges Logto to the learner access contract and reports what it found and changed.
 * @param {ManagementApi} api
 * @param {LearnerAccessTarget} target
 */
export async function provisionLearnerAccess(api, { resource }) {
  const settings = learnerAccessSettings;
  const resourceId = await ensureResource(api, resource);
  const scopeId = await ensureScope(api, resourceId);
  const roleId = await ensureDefaultRole(api, scopeId);
  const users = await assignRoleToEveryUser(api, roleId);
  await api("/configs/cimd", {
    method: "PATCH",
    body: { enabled: true, addConsentPromptForOfflineAccess: true },
  });
  // The ceiling of every dynamic app is exactly the learning scope.
  const cimdScopeIds = await cimdResourceScopeIds(api);
  for (const extra of cimdScopeIds.filter((scope) => scope !== scopeId))
    await api(`/cimd/user-consent-scopes/resource-scopes/${extra}`, {
      method: "DELETE",
    });
  if (!cimdScopeIds.includes(scopeId))
    await api("/cimd/user-consent-scopes", {
      method: "POST",
      body: { resourceScopes: [scopeId] },
    });
  const clientId = await ensurePublicClient(api);
  return {
    resource,
    resourceId,
    scope: settings.scope,
    roleId,
    usersTotal: users.total,
    usersAssigned: users.assigned,
    publicClientId: clientId,
  };
}

/**
 * Read-only: lists every deviation from the contract; an empty list means Logto is converged.
 * @param {ManagementApi} api
 * @param {LearnerAccessTarget} target
 */
export async function checkLearnerAccess(api, { resource }) {
  const settings = learnerAccessSettings;
  /** @type {string[]} */
  const problems = [];
  const found = (await list(api, "/resources")).filter(
    (row) => row["indicator"] === resource,
  );
  const [row] = found;
  if (found.length !== 1 || row === undefined)
    return [`expected one API resource ${resource}, found ${found.length}`];
  if (row["accessTokenTtl"] !== settings.accessTokenTtl)
    problems.push(
      `resource access token TTL is ${String(row["accessTokenTtl"])}`,
    );
  const scope = (await list(api, `/resources/${id(row)}/scopes`)).find(
    (candidate) => candidate["name"] === settings.scope,
  );
  if (scope === undefined)
    return [...problems, `scope ${settings.scope} is missing`];
  const role = (await list(api, "/roles")).find(
    (candidate) => candidate["name"] === settings.roleName,
  );
  if (role === undefined) problems.push(`role ${settings.roleName} is missing`);
  else {
    if (role["isDefault"] !== true)
      problems.push("learner role is not a default role");
    const roleScopes = (await list(api, `/roles/${id(role)}/scopes`)).map(id);
    if (roleScopes.length !== 1 || roleScopes[0] !== id(scope))
      problems.push("learner role must carry exactly the learning scope");
    let missing = 0;
    for (const user of await list(api, "/users"))
      if (!(await userRoleIds(api, user)).includes(id(role))) missing += 1;
    if (missing > 0) problems.push(`${missing} users have no learner role`);
  }
  const cimd = record(await api("/configs/cimd"));
  if (cimd["enabled"] !== true)
    problems.push("dynamic apps (CIMD) are disabled");
  if (cimd["addConsentPromptForOfflineAccess"] !== true)
    problems.push("CIMD refresh token compatibility is off");
  const cimdScopeIds = await cimdResourceScopeIds(api);
  if (cimdScopeIds.length !== 1 || cimdScopeIds[0] !== id(scope))
    problems.push(`CIMD resource scopes must be exactly ${settings.scope}`);
  const client = (await list(api, "/applications")).find(
    (candidate) => candidate["name"] === settings.clientName,
  );
  if (client === undefined)
    problems.push(`public client ${settings.clientName} is missing`);
  else {
    if (client["type"] !== "Native")
      problems.push("public client is not Native");
    const metadata = record(client["oidcClientMetadata"]);
    const redirects = Array.isArray(metadata["redirectUris"])
      ? metadata["redirectUris"]
      : [];
    if (settings.redirectUris.some((uri) => !redirects.includes(uri)))
      problems.push("public client lacks a loopback redirect");
    if (record(client["customClientMetadata"])["rotateRefreshToken"] !== true)
      problems.push("public client does not rotate refresh tokens");
    if (
      record(client["customData"])["addConsentPromptForOfflineAccess"] !== true
    )
      problems.push(
        "public client gets no refresh token without prompt=consent",
      );
  }
  return problems;
}

/** @param {ManagementApi} api @param {string} indicator */
async function ensureResource(api, indicator) {
  const settings = learnerAccessSettings;
  const found = (await list(api, "/resources")).filter(
    (row) => row["indicator"] === indicator,
  );
  if (found.length > 1)
    throw new Error(`Several API resources use ${indicator}`);
  const [current] = found;
  if (current === undefined)
    return id(
      await api("/resources", {
        method: "POST",
        body: {
          name: settings.resourceName,
          indicator,
          accessTokenTtl: settings.accessTokenTtl,
        },
      }),
    );
  await api(`/resources/${id(current)}`, {
    method: "PATCH",
    body: { accessTokenTtl: settings.accessTokenTtl },
  });
  return id(current);
}

/** @param {ManagementApi} api @param {string} resourceId */
async function ensureScope(api, resourceId) {
  const settings = learnerAccessSettings;
  const path = `/resources/${resourceId}/scopes`;
  const current = (await list(api, path)).find(
    (row) => row["name"] === settings.scope,
  );
  return id(
    current ??
      (await api(path, {
        method: "POST",
        body: { name: settings.scope, description: settings.scopeDescription },
      })),
  );
}

/** @param {ManagementApi} api @param {string} scopeId */
async function ensureDefaultRole(api, scopeId) {
  const settings = learnerAccessSettings;
  const names = [settings.roleName, ...settings.legacyRoleNames];
  const found = (await list(api, "/roles")).filter((row) =>
    names.includes(String(row["name"])),
  );
  if (found.length > 1)
    throw new Error(
      "Several learner roles exist; reconcile them before retrying",
    );
  const [current] = found;
  if (current === undefined)
    return id(
      await api("/roles", {
        method: "POST",
        body: {
          name: settings.roleName,
          description: "Learner MCP connection; no product entitlement",
          type: "User",
          isDefault: true,
          scopeIds: [scopeId],
        },
      }),
    );
  const assigned = (await list(api, `/roles/${id(current)}/scopes`)).map(id);
  if (current["type"] !== "User" || assigned.some((scope) => scope !== scopeId))
    throw new Error(
      "The learner role has an unexpected type or permissions; reconcile it before retrying",
    );
  await api(`/roles/${id(current)}`, {
    method: "PATCH",
    body: { name: settings.roleName, isDefault: true },
  });
  if (!assigned.includes(scopeId))
    await api(`/roles/${id(current)}/scopes`, {
      method: "POST",
      body: { scopeIds: [scopeId] },
    });
  return id(current);
}

/**
 * The default role covers new accounts; existing accounts get it once. Other roles stay.
 * @param {ManagementApi} api @param {string} roleId
 */
async function assignRoleToEveryUser(api, roleId) {
  let total = 0;
  let assigned = 0;
  for (const user of await list(api, "/users")) {
    total += 1;
    if ((await userRoleIds(api, user)).includes(roleId)) continue;
    await api(`/users/${id(user)}/roles`, {
      method: "POST",
      body: { roleIds: [roleId] },
    });
    assigned += 1;
  }
  return { total, assigned };
}

/** The largest page Logto serves; every list is read page by page to its end. */
const pageSize = 100;

/** @param {ManagementApi} api @param {string} path */
async function list(api, path) {
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let page = 1; ; page += 1) {
    const batch = records(
      await api(`${path}?page=${String(page)}&page_size=${String(pageSize)}`),
    );
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

/** @param {ManagementApi} api @param {Record<string, unknown>} user */
async function userRoleIds(api, user) {
  return (await list(api, `/users/${id(user)}/roles`)).map(id);
}

/** @param {ManagementApi} api */
async function cimdResourceScopeIds(api) {
  const ceiling = record(await api("/cimd/user-consent-scopes"));
  const groups = Array.isArray(ceiling["resourceScopes"])
    ? ceiling["resourceScopes"]
    : [];
  return groups.flatMap((group) => records(record(group)["scopes"]).map(id));
}

/** Public PKCE client for MCP clients without CIMD; no secret and no token exchange.
 * @param {ManagementApi} api */
async function ensurePublicClient(api) {
  const settings = learnerAccessSettings;
  const names = [settings.clientName, ...settings.legacyClientNames];
  const found = (await list(api, "/applications")).filter((row) =>
    names.includes(String(row["name"])),
  );
  if (found.length > 1)
    throw new Error(
      "Several learner public clients exist; reconcile them before retrying",
    );
  const [current] = found;
  if (current !== undefined && current["type"] !== "Native")
    throw new Error("The learner public client is not a Native application");
  const body = {
    name: settings.clientName,
    oidcClientMetadata: {
      redirectUris: settings.redirectUris,
      postLogoutRedirectUris: [],
    },
    customClientMetadata: { rotateRefreshToken: true },
    // Inside fork patch #938: Logto adds prompt=consent so the client receives a refresh token.
    customData: { addConsentPromptForOfflineAccess: true },
  };
  return id(
    current === undefined
      ? await api("/applications", {
          method: "POST",
          body: { ...body, type: "Native" },
        })
      : await api(`/applications/${id(current)}`, { method: "PATCH", body }),
  );
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Logto Management API returned an unexpected payload");
  /** @type {Record<string, unknown>} */
  const fields = {};
  for (const [name, field] of Object.entries(value)) fields[name] = field;
  return fields;
}

/** @param {unknown} value */
function records(value) {
  if (!Array.isArray(value))
    throw new Error("Logto Management API returned an unexpected list");
  return value.map(record);
}

/** @param {unknown} value */
function id(value) {
  const identifier = record(value)["id"];
  if (typeof identifier !== "string" || identifier.length === 0)
    throw new Error("Logto Management API returned an entity without id");
  return identifier;
}

/**
 * Production entry point inside the Logto container: the admin port issues a Management API token
 * for the seeded `m-default` client, and the default tenant answers at its public endpoint.
 */
async function main() {
  const argv = process.argv.slice(2);
  const resourceIndex = argv.indexOf("--resource");
  const resource = resourceIndex === -1 ? undefined : argv[resourceIndex + 1];
  if (resource === undefined || !URL.canParse(resource))
    throw new Error(
      "Usage: learner-access.mjs --resource <learner MCP URL> [--check]",
    );
  const endpoint = process.env["ENDPOINT"];
  if (endpoint === undefined)
    throw new Error("ENDPOINT of the Logto tenant is not set");
  const secret = (await text(process.stdin)).trim();
  if (secret.length < 20)
    throw new Error("The Management API client secret is missing on stdin");
  const response = await fetch("http://localhost:3002/oidc/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`m-default:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: "https://default.logto.app/api",
      scope: "all",
    }),
  });
  if (!response.ok)
    throw new Error(`Management API token request failed: ${response.status}`);
  const accessToken = record(await response.json())["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throw new Error("Management API token response has no access token");
  /** @type {ManagementApi} */
  const api = async (path, { method = "GET", body } = {}) => {
    const reply = await fetch(`${endpoint}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // The response body may echo input; only the status reaches the log.
    if (!reply.ok)
      throw new Error(
        `${method} ${path.split("?")[0]} failed: ${reply.status}`,
      );
    const payload = await reply.text();
    if (payload.length === 0) return null;
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(payload);
      return parsed;
    } catch {
      // A parse error quotes the body, and user lists carry personal data.
      throw new Error(`${method} ${path.split("?")[0]} returned invalid JSON`);
    }
  };
  if (argv.includes("--check")) {
    const problems = await checkLearnerAccess(api, { resource });
    process.stdout.write(
      `${JSON.stringify({ resource, problems }, null, 2)}\n`,
    );
    if (problems.length > 0) process.exitCode = 1;
    return;
  }
  const summary = await provisionLearnerAccess(api, { resource });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  await main();
}
