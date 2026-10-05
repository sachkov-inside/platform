// @ts-check
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  checkLearnerAccess,
  learnerAccessSettings,
  provisionLearnerAccess,
} from "../infra/production/logto/learner-access.mjs";

const resource = "https://inside.example.test/mcp/learning";

/**
 * In-memory Logto Management API with the routes the learner provisioning uses.
 * @param {Partial<FakeLogto>} [seed]
 */
function fakeLogto(seed = {}) {
  /** @type {FakeLogto} */
  const state = {
    resources: [],
    scopes: [],
    roles: [],
    roleScopes: [],
    users: [],
    userRoles: [],
    applications: [],
    cimd: { enabled: false },
    cimdResourceScopes: [],
    ...seed,
  };
  let sequence = 0;
  const nextId = () => `id-${String((sequence += 1))}`;
  /** @type {string[]} */
  const writes = [];
  /** @type {import("../infra/production/logto/learner-access.mjs").ManagementApi} */
  const handle = async (path, { method = "GET", body } = {}) => {
    const input = asRow(body ?? {});
    const [route = ""] = path.split("?");
    if (method !== "GET") writes.push(`${method} ${route}`);
    const parts = route.split("/").filter(Boolean);
    const literal =
      route === "/configs/cimd" || route === "/cimd/user-consent-scopes";
    const key = literal
      ? `${method} ${route}`
      : `${method} /${parts.map((part, index) => (index % 2 === 1 ? ":id" : part)).join("/")}`;
    switch (key) {
      case "GET /resources":
        return state.resources;
      case "POST /resources": {
        const created = { id: nextId(), ...input };
        state.resources.push(created);
        return created;
      }
      case "PATCH /resources/:id":
        return Object.assign(findById(state.resources, parts[1]), input);
      case "GET /resources/:id/scopes":
        return state.scopes.filter((scope) => scope["resourceId"] === parts[1]);
      case "POST /resources/:id/scopes": {
        const created = { id: nextId(), resourceId: parts[1], ...input };
        state.scopes.push(created);
        return created;
      }
      case "GET /roles":
        return state.roles;
      case "POST /roles": {
        const { scopeIds, ...role } = input;
        const created = { id: nextId(), ...role };
        state.roles.push(created);
        for (const scopeId of strings(scopeIds))
          state.roleScopes.push([created.id, scopeId]);
        return created;
      }
      case "PATCH /roles/:id":
        return Object.assign(findById(state.roles, parts[1]), input);
      case "GET /roles/:id/scopes":
        return state.roleScopes
          .filter(([roleId]) => roleId === parts[1])
          .map(([, scopeId]) => findById(state.scopes, scopeId));
      case "POST /roles/:id/scopes":
        for (const scopeId of strings(input["scopeIds"]))
          state.roleScopes.push([String(parts[1]), scopeId]);
        return null;
      case "GET /users":
        return state.users;
      case "GET /users/:id/roles":
        return state.userRoles
          .filter(([userId]) => userId === parts[1])
          .map(([, roleId]) => findById(state.roles, roleId));
      case "POST /users/:id/roles":
        for (const roleId of strings(input["roleIds"]))
          state.userRoles.push([String(parts[1]), roleId]);
        return null;
      case "GET /configs/cimd":
        return state.cimd;
      case "PATCH /configs/cimd":
        return Object.assign(state.cimd, input);
      case "GET /cimd/user-consent-scopes":
        return {
          resourceScopes:
            state.cimdResourceScopes.length === 0
              ? []
              : [
                  {
                    resource: {},
                    scopes: state.cimdResourceScopes.map((id) => ({ id })),
                  },
                ],
        };
      case "POST /cimd/user-consent-scopes":
        state.cimdResourceScopes.push(...strings(input["resourceScopes"]));
        return null;
      case "GET /applications":
        return state.applications;
      case "POST /applications": {
        const created = { id: nextId(), ...input };
        state.applications.push(created);
        return created;
      }
      case "PATCH /applications/:id":
        return Object.assign(findById(state.applications, parts[1]), input);
      default:
        if (
          method === "DELETE" &&
          route.startsWith("/cimd/user-consent-scopes/resource-scopes/")
        ) {
          state.cimdResourceScopes = state.cimdResourceScopes.filter(
            (scopeId) => scopeId !== parts.at(-1),
          );
          return null;
        }
        throw new Error(`Unexpected Management API call ${key}`);
    }
  };
  /** Logto lists answer one page; the fake slices every list the same way. */
  /** @type {import("../infra/production/logto/learner-access.mjs").ManagementApi} */
  const api = async (path, init) => {
    const result = await handle(path, init);
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    if (!Array.isArray(result)) return result;
    // Без параметров Logto отдаёт первую страницу из 20 строк.
    const size = Number(params.get("page_size") ?? "20");
    const page = Number(params.get("page") ?? "1");
    /** @type {unknown[]} */
    const rows = result;
    return rows.slice((page - 1) * size, page * size);
  };
  return { api, state, writes };
}

/**
 * @typedef {{
 *   resources: Record<string, unknown>[];
 *   scopes: Record<string, unknown>[];
 *   roles: Record<string, unknown>[];
 *   roleScopes: [string, string][];
 *   users: Record<string, unknown>[];
 *   userRoles: [string, string][];
 *   applications: Record<string, unknown>[];
 *   cimd: Record<string, unknown>;
 *   cimdResourceScopes: string[];
 * }} FakeLogto
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRow(value) {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return Object.fromEntries(Object.entries(value));
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  assert.ok(Array.isArray(value));
  return value.map(String);
}

/** @param {Record<string, unknown>[]} rows @param {string | undefined} id */
function findById(rows, id) {
  const row = rows.find((candidate) => candidate["id"] === id);
  if (row === undefined) throw new Error(`Unknown id ${String(id)}`);
  return row;
}

test("a fresh tenant gives every account the learning scope through any MCP client", async () => {
  const users = Array.from({ length: 101 }, (_, index) => ({
    id: `user-${String(index)}`,
  }));
  const logto = fakeLogto({
    users,
    userRoles: [["user-0", "owner-role"]],
    roles: [{ id: "owner-role", name: "Owner", type: "User" }],
  });
  assert.notDeepEqual(await checkLearnerAccess(logto.api, { resource }), []);

  const summary = await provisionLearnerAccess(logto.api, { resource });

  assert.deepEqual(await checkLearnerAccess(logto.api, { resource }), []);
  assert.equal(summary.usersTotal, 101);
  assert.equal(summary.usersAssigned, 101);
  const [created] = logto.state.resources;
  assert.equal(created?.["indicator"], resource);
  assert.equal(created?.["accessTokenTtl"], 300);
  assert.deepEqual(logto.state.cimd, {
    enabled: true,
    addConsentPromptForOfflineAccess: true,
  });
  const role = logto.state.roles.find(
    ({ name }) => name === learnerAccessSettings.roleName,
  );
  assert.equal(role?.["isDefault"], true);
  // Существующие роли аккаунта сохраняются: учебная роль добавляется рядом.
  assert.deepEqual(
    logto.state.userRoles
      .filter(([userId]) => userId === "user-0")
      .map(([, roleId]) => roleId),
    ["owner-role", role?.["id"]],
  );
  const [client] = logto.state.applications;
  assert.equal(client?.["type"], "Native");
  assert.equal(client?.["id"], summary.publicClientId);
  assert.equal(client?.["clientSecret"], undefined);
  assert.deepEqual(asRow(client?.["oidcClientMetadata"])["redirectUris"], [
    "http://127.0.0.1/callback",
    "http://127.0.0.1/mcp/oauth/callback",
    "http://localhost/callback",
    "http://localhost/mcp/oauth/callback",
  ]);
});

test("production adopts the author-pass role and client and repeats without writes beyond patches", async () => {
  const logto = fakeLogto({
    resources: [
      {
        id: "learn",
        name: "Inside learner MCP",
        indicator: resource,
        accessTokenTtl: 300,
      },
    ],
    scopes: [{ id: "read", resourceId: "learn", name: "learning:read" }],
    roles: [
      {
        id: "author",
        name: "Inside learner connection (author pass)",
        type: "User",
        isDefault: false,
      },
    ],
    roleScopes: [["author", "read"]],
    users: [{ id: "owner" }, { id: "learner" }],
    userRoles: [["owner", "author"]],
    cimdResourceScopes: ["foreign-scope"],
    applications: [
      {
        id: "o92nmcpzb2te8z4loi82d",
        name: "Inside Learner Codex",
        type: "Native",
        oidcClientMetadata: {
          redirectUris: ["http://127.0.0.1:4387/callback"],
        },
      },
    ],
  });

  const first = await provisionLearnerAccess(logto.api, { resource });
  assert.equal(first.roleId, "author");
  assert.equal(first.publicClientId, "o92nmcpzb2te8z4loi82d");
  assert.equal(first.usersAssigned, 1);
  assert.equal(logto.state.roles.length, 1);
  assert.equal(logto.state.applications.length, 1);
  assert.deepEqual(await checkLearnerAccess(logto.api, { resource }), []);

  logto.writes.length = 0;
  const second = await provisionLearnerAccess(logto.api, { resource });
  assert.equal(second.usersAssigned, 0);
  // Повтор только подтверждает настройки и ничего не создаёт.
  assert.deepEqual(
    logto.writes.filter((write) => write.startsWith("POST")),
    [],
  );
});

test("a learner role with foreign permissions stops provisioning", async () => {
  const logto = fakeLogto({
    resources: [{ id: "learn", indicator: resource, accessTokenTtl: 300 }],
    scopes: [
      { id: "read", resourceId: "learn", name: "learning:read" },
      { id: "write", resourceId: "learn", name: "materials:manage" },
    ],
    roles: [{ id: "role", name: "Inside learner connection", type: "User" }],
    roleScopes: [["role", "write"]],
  });

  await assert.rejects(
    provisionLearnerAccess(logto.api, { resource }),
    /unexpected type or permissions/u,
  );
});

test("Reader names the same loopback callback paths the public client registers", async () => {
  const source = await readFile(
    new URL(
      "../apps/web/src/_pages/material-reader/model/practice-review-setup.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const paths = /learnerMcpCallbackPaths = (\[[^\]]+\])/u.exec(source)?.[1];
  assert.ok(paths);
  assert.deepEqual(
    learnerAccessSettings.redirectUris.map((uri) => new URL(uri).pathname),
    [...strings(JSON.parse(paths)), ...strings(JSON.parse(paths))],
  );
});
