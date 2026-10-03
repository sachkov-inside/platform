// @ts-check
import { z } from "zod";
import { learnerStandProfile } from "./learner-stand-setup.mjs";

const entity = z.object({ id: z.string(), name: z.string() });
const roleName = "Inside local learner connection";

/** A transport scope only: ContentAccess still decides which lessons may be read.
 * @param {import('./identity-proof-bootstrap.mjs').ManagementApi} api */
export async function ensureLearnerStandPermission(api) {
  const resources = z
    .array(entity.extend({ indicator: z.string() }))
    .parse(await api("/resources"));
  const resource = resources.find(
    (row) => row.indicator === learnerStandProfile.url,
  );
  if (!resource) throw new Error("Learner stand resource is missing");
  const scopePath = `/resources/${resource.id}/scopes`;
  const scopes = z.array(entity).parse(await api(scopePath));
  const scope =
    scopes.find((row) => row.name === learnerStandProfile.scope) ??
    entity.parse(
      await api(scopePath, {
        method: "POST",
        body: {
          name: learnerStandProfile.scope,
          description: "Connect to local learner MCP; no product entitlement",
        },
      }),
    );
  const roles = z
    .array(entity.extend({ type: z.string() }))
    .parse(await api("/roles"));
  const existing = roles.find((row) => row.name === roleName);
  const role =
    existing ??
    entity.parse(
      await api("/roles", {
        method: "POST",
        body: {
          name: roleName,
          description: "Local learner MCP connection only",
          type: "User",
          isDefault: true,
          scopeIds: [scope.id],
        },
      }),
    );
  if (existing) {
    const assigned = z
      .array(entity)
      .parse(await api(`/roles/${role.id}/scopes`));
    if (
      existing.type !== "User" ||
      assigned.some((row) => row.id !== scope.id)
    ) {
      throw new Error(
        "Local learner role has unexpected type or permissions; preserve and reconcile it before retrying",
      );
    }
    await api(`/roles/${role.id}`, {
      method: "PATCH",
      body: { isDefault: true },
    });
    if (!assigned.some((row) => row.id === scope.id))
      await api(`/roles/${role.id}/scopes`, {
        method: "POST",
        body: { scopeIds: [scope.id] },
      });
  }
  // Default roles cover new registrations; preserve all existing roles during stand upgrades.
  for (let page = 1; ; page += 1) {
    const users = z
      .array(z.object({ id: z.string() }))
      .parse(await api(`/users?page=${page}&page_size=100`));
    for (const user of users) {
      const assigned = z
        .array(entity)
        .parse(await api(`/users/${user.id}/roles`));
      if (!assigned.some((row) => row.id === role.id))
        await api(`/users/${user.id}/roles`, {
          method: "POST",
          body: { roleIds: [role.id] },
        });
    }
    if (users.length < 100) break;
  }
}
