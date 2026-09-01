import { randomUUID } from "node:crypto";

import type {
  AccessAction,
  AccessAvailability,
  AccessBatchRequest,
  AccessDecision,
  AccessRequest,
  AvailabilityBatchResult,
  ContentAccess,
  DenyReason,
  Resource,
  Subject,
} from "./content-access.interface.js";
import type {
  ContentAccessDependencies,
  MaterialResourceFacts,
  MembershipAccessState,
} from "./content-access.dependencies.js";

const MAX_BATCH_SIZE = 100;

interface SubjectFacts {
  readonly permission: "granted" | "denied" | "unavailable";
  readonly membership?: MembershipAccessState;
}

interface ResolvedResourceFacts extends MaterialResourceFacts {
  readonly resourceKey: string;
  readonly resourceKind: "file_asset" | "image_asset" | "material";
}

export function assembleContentAccess(
  dependencies: ContentAccessDependencies,
): ContentAccess {
  const clock = dependencies.clock ?? (() => new Date());
  const decisionId = dependencies.decisionId ?? randomUUID;

  return Object.freeze({
    async checkAvailabilityMany(
      input: AccessBatchRequest,
    ): Promise<AvailabilityBatchResult> {
      if (input.operations.length === 0) {
        return { ok: false, error: { code: "empty_batch" } };
      }
      if (input.operations.length > MAX_BATCH_SIZE) {
        return { ok: false, error: { code: "batch_too_large" } };
      }
      const itemIds = new Set(input.operations.map(({ itemId }) => itemId));
      if (itemIds.size !== input.operations.length) {
        return { ok: false, error: { code: "duplicate_item_id" } };
      }

      let resourcesByKey: ReadonlyMap<string, ResolvedResourceFacts>;
      try {
        resourcesByKey = await resolveManyResourceFacts(
          dependencies,
          input.operations.map(({ resource }) => resource),
        );
      } catch {
        return {
          ok: true,
          items: input.operations.map(({ itemId }) => ({
            itemId,
            availability: "unavailable" as const,
          })),
        };
      }
      const needsProtectedFacts = input.operations.some((operation) => {
        const facts = resourcesByKey.get(resourceKey(operation.resource));
        return facts !== undefined && needsSubjectFacts(facts, operation.action);
      });
      const needsMembershipFacts = input.operations.some((operation) => {
        const facts = resourcesByKey.get(resourceKey(operation.resource));
        return facts !== undefined && needsMembership(facts, operation.action);
      });
      const subjectFacts = needsProtectedFacts
        ? await resolveSubjectFacts(
            dependencies,
            input.subject,
            needsMembershipFacts,
          )
        : undefined;

      return {
        ok: true,
        items: input.operations.map(({ itemId, resource, action }) => ({
          itemId,
          availability: projectAvailability(
            resourcesByKey.get(resourceKey(resource)),
            action,
            input.subject,
            subjectFacts,
          ),
        })),
      };
    },

    async authorize(input: AccessRequest): Promise<AccessDecision> {
      let facts: ResolvedResourceFacts | null;
      try {
        facts = await resolveOneResourceFacts(dependencies, input.resource);
      } catch {
        return decision("dependency_unavailable");
      }
      if (facts === null) {
        return decision("resource_not_found");
      }
      if (facts.resourceKey !== resourceKey(input.resource)) {
        return decision("resource_mismatch");
      }
      if (!needsSubjectFacts(facts, input.action)) {
        const reason = resourceReason(facts, input.action);
        return reason === "public_resource"
          ? allow(reason, facts.contentVersion)
          : decision(reason ?? "resource_action_invalid");
      }

      const subjectFacts = await resolveSubjectFacts(
        dependencies,
        input.subject,
        needsMembership(facts, input.action),
      );
      const reason = evaluate(facts, input.action, input.subject, subjectFacts);
      if (reason === "public_resource" || reason === "materials_manager") {
        return allow(reason, facts.contentVersion);
      }
      if (reason === "active_membership") {
        if (subjectFacts?.membership?.kind !== "active") {
          return decision("dependency_unavailable");
        }
        return {
          ...metadata(),
          effect: "allow",
          reason,
          validUntil: subjectFacts.membership.validUntil,
          checkedContentVersion: facts.contentVersion,
        };
      }
      return decision(reason);
    },
  });

  function metadata() {
    return {
      decisionId: decisionId(),
      policyVersion: "content-access-v1" as const,
      decidedAt: clock().toISOString(),
    };
  }

  function decision(reason: DenyReason): AccessDecision {
    return { ...metadata(), effect: "deny", reason };
  }

  function allow(
    reason: "public_resource" | "materials_manager",
    checkedContentVersion: number,
  ): AccessDecision {
    return { ...metadata(), effect: "allow", reason, checkedContentVersion };
  }
}

async function resolveSubjectFacts(
  dependencies: ContentAccessDependencies,
  subject: Subject,
  includeMembership: boolean,
): Promise<SubjectFacts | undefined> {
  if (subject.kind === "anonymous") {
    return undefined;
  }
  let managesMaterials: boolean;
  try {
    managesMaterials = await dependencies.accountPermissions.hasMaterialsManage(
      subject.accountId,
    );
  } catch {
    return { permission: "unavailable" };
  }
  if (managesMaterials) {
    return { permission: "granted" };
  }
  if (!includeMembership) {
    return { permission: "denied" };
  }
  try {
    return {
      permission: "denied",
      membership: await dependencies.membershipEntitlements.resolveForAccess(
        subject.accountId,
      ),
    };
  } catch {
    return {
      permission: "denied",
      membership: { kind: "unavailable" },
    };
  }
}

function needsSubjectFacts(
  facts: ResolvedResourceFacts,
  action: AccessAction,
): boolean {
  return resourceReason(facts, action) === undefined;
}

function needsMembership(
  facts: ResolvedResourceFacts,
  action: AccessAction,
): boolean {
  return (action === "read" || action === "download") &&
    facts.publicationState === "published" &&
    facts.access === "membership";
}

function projectAvailability(
  facts: ResolvedResourceFacts | undefined,
  action: AccessAction,
  subject: Subject,
  subjectFacts: SubjectFacts | undefined,
): AccessAvailability["availability"] {
  if (facts === undefined || facts.publicationState !== "published") {
    return "unavailable";
  }
  const reason = evaluate(facts, action, subject, subjectFacts);
  if (
    reason === "public_resource" ||
    reason === "materials_manager" ||
    reason === "active_membership"
  ) {
    return "available";
  }
  if (reason === "resource_action_invalid") {
    return "unavailable";
  }
  return facts.access === "membership" ? "locked" : "unavailable";
}

function evaluate(
  facts: ResolvedResourceFacts,
  action: AccessAction,
  subject: Subject,
  subjectFacts: SubjectFacts | undefined,
):
  | DenyReason
  | "public_resource"
  | "materials_manager"
  | "active_membership" {
  const resource = resourceReason(facts, action);
  if (resource !== undefined) {
    return resource;
  }
  if (subject.kind === "anonymous") {
    return "authentication_required";
  }
  if (subjectFacts?.permission === "unavailable" || subjectFacts === undefined) {
    return "dependency_unavailable";
  }
  if (subjectFacts.permission === "granted") {
    return "materials_manager";
  }
  if (action === "preview") {
    return "permission_required";
  }
  switch (subjectFacts?.membership?.kind) {
    case "active":
      return "active_membership";
    case "expired":
      return "membership_expired";
    case "stale":
      return "entitlement_stale";
    case "required":
      return "membership_required";
    case "unavailable":
    case undefined:
      return "dependency_unavailable";
  }
}

function resourceReason(
  facts: ResolvedResourceFacts,
  action: AccessAction,
): DenyReason | "public_resource" | undefined {
  const validPair = action === "preview" ||
    (facts.resourceKind === "material" && action === "read") ||
    (facts.resourceKind === "image_asset" && action === "read") ||
    (facts.resourceKind === "file_asset" && action === "download");
  if (!validPair) {
    return "resource_action_invalid";
  }
  if ((action === "read" || action === "download") && facts.publicationState !== "published") {
    return "resource_unpublished";
  }
  if ((action === "read" || action === "download") && facts.access === "free") {
    return "public_resource";
  }
  return undefined;
}

async function resolveOneResourceFacts(
  dependencies: ContentAccessDependencies,
  resource: Resource,
): Promise<ResolvedResourceFacts | null> {
  if (resource.kind === "material") {
    const material = await dependencies.materialResourceFacts.findOne(
      resource.materialId,
    );
    return material === null
      ? null
      : resolveMaterialFacts(material, "material", `material:${material.materialId}`);
  }
  const asset = await dependencies.assetResourceFacts?.findOne(resource.assetId) ?? null;
  if (asset === null) return null;
  const material = await dependencies.materialResourceFacts.findOne(asset.materialId);
  if (material === null) return null;
  return resolveMaterialFacts(
    material,
    asset.kind === "file" ? "file_asset" : "image_asset",
    `asset:${asset.assetId}`,
  );
}

async function resolveManyResourceFacts(
  dependencies: ContentAccessDependencies,
  resources: readonly Resource[],
): Promise<ReadonlyMap<string, ResolvedResourceFacts>> {
  const assetIds = [...new Set(resources.flatMap((resource) =>
    resource.kind === "asset" ? [resource.assetId] : [],
  ))];
  const assets = assetIds.length === 0
    ? []
    : await dependencies.assetResourceFacts?.findMany(assetIds) ?? [];
  const materialIds = [...new Set([
    ...resources.flatMap((resource) =>
      resource.kind === "material" ? [resource.materialId] : [],
    ),
    ...assets.map(({ materialId }) => materialId),
  ])];
  const materials = await dependencies.materialResourceFacts.findMany(materialIds);
  const materialsById = new Map(materials.map((facts) => [facts.materialId, facts]));
  const assetsById = new Map(assets.map((facts) => [facts.assetId, facts]));
  return new Map(resources.flatMap((resource): readonly [string, ResolvedResourceFacts][] => {
    if (resource.kind === "material") {
      const material = materialsById.get(resource.materialId);
      return material === undefined
        ? []
        : [[resourceKey(resource), resolveMaterialFacts(material, "material", resourceKey(resource))]];
    }
    const asset = assetsById.get(resource.assetId);
    const material = asset === undefined
      ? undefined
      : materialsById.get(asset.materialId);
    return asset === undefined || material === undefined
      ? []
      : [[
          resourceKey(resource),
          resolveMaterialFacts(
            material,
            asset.kind === "file" ? "file_asset" : "image_asset",
            `asset:${asset.assetId}`,
          ),
        ]];
  }));
}

function resolveMaterialFacts(
  material: MaterialResourceFacts,
  resourceKind: ResolvedResourceFacts["resourceKind"],
  resourceKeyValue: string,
): ResolvedResourceFacts {
  return { ...material, resourceKey: resourceKeyValue, resourceKind };
}

function resourceKey(resource: Resource): string {
  return resource.kind === "material"
    ? `material:${resource.materialId}`
    : `asset:${resource.assetId}`;
}
