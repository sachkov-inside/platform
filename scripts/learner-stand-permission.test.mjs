// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { ensureLearnerStandPermission } from "./learner-stand-permission.mjs";
import { learnerStandProfile } from "./learner-stand-setup.mjs";

test("local learner connection scope preserves roles and repeats without new assignments", async () => {
  /** @type {Array<{id:string,name:string}>} */
  const scopes = [];
  /** @type {Array<{id:string,name:string,type:string}>} */
  const roles = [];
  const userRoles = [{ id: "owner", name: "Existing owner" }];
  /** @type {Array<{path:string,method:string,body:unknown}>} */
  const writes = [];
  /** @type {import('./identity-proof-bootstrap.mjs').ManagementApi} */
  const api = async (path, { method = "GET", body } = {}) => {
    if (method !== "GET") writes.push({ path, method, body });
    if (path === "/resources")
      return [
        { id: "learner", name: "Learner", indicator: learnerStandProfile.url },
      ];
    if (path === "/resources/learner/scopes") {
      if (method === "POST") {
        scopes.push({ id: "connect", name: learnerStandProfile.scope });
        return scopes[0];
      }
      return scopes;
    }
    if (path === "/roles") {
      if (method === "POST") {
        roles.push({
          id: "connection",
          name: "Inside local learner connection",
          type: "User",
        });
        return roles[0];
      }
      return roles;
    }
    if (path === "/roles/connection") return roles[0];
    if (path === "/roles/connection/scopes") return scopes;
    if (path === "/users?page=1&page_size=100") return [{ id: "student" }];
    if (path === "/users/student/roles") {
      if (method === "POST")
        userRoles.push({
          id: "connection",
          name: "Inside local learner connection",
        });
      return userRoles;
    }
    throw new Error(`Unexpected API call ${method} ${path}`);
  };
  await ensureLearnerStandPermission(api);
  await ensureLearnerStandPermission(api);
  assert.equal(scopes.length, 1);
  assert.equal(roles.length, 1);
  assert.deepEqual(
    userRoles.map((row) => row.id),
    ["owner", "connection"],
  );
  assert.equal(
    writes.filter((row) => row.path === "/users/student/roles").length,
    1,
  );
  assert.deepEqual(writes.find((row) => row.path === "/roles")?.body, {
    name: "Inside local learner connection",
    description: "Local learner MCP connection only",
    type: "User",
    isDefault: true,
    scopeIds: ["connect"],
  });
  assert.ok(
    writes.every((row) => row.method !== "PUT" && row.method !== "DELETE"),
  );
});

for (const mismatch of ["foreign-scope", "machine-role"]) {
  test(`learner bootstrap preserves an existing role with ${mismatch}`, async () => {
    /** @type {string[]} */
    const writes = [];
    /** @type {import('./identity-proof-bootstrap.mjs').ManagementApi} */
    const api = async (path, { method = "GET" } = {}) => {
      if (method !== "GET") writes.push(path);
      if (path === "/resources")
        return [
          {
            id: "learner",
            name: "Learner",
            indicator: learnerStandProfile.url,
          },
        ];
      if (path === "/resources/learner/scopes")
        return [{ id: "connect", name: learnerStandProfile.scope }];
      if (path === "/roles")
        return [
          {
            id: "connection",
            name: "Inside local learner connection",
            type: mismatch === "machine-role" ? "MachineToMachine" : "User",
          },
        ];
      if (path === "/roles/connection/scopes")
        return [
          {
            id: mismatch === "foreign-scope" ? "authoring" : "connect",
            name: "scope",
          },
        ];
      throw new Error(`Unexpected API call ${method} ${path}`);
    };
    await assert.rejects(
      ensureLearnerStandPermission(api),
      /unexpected type or permissions/u,
    );
    assert.deepEqual(writes, []);
  });
}
