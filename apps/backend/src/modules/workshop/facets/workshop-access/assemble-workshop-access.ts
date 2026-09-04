import { randomUUID } from "node:crypto";

import type { WorkshopEntitlementState } from "../workshop-entitlements/workshop-entitlements.interface.js";
import type {
  WorkshopAccess,
  WorkshopAccessDecision,
  WorkshopAccessDependencies,
  WorkshopAccessDenyReason,
  WorkshopAccessRequest,
  WorkshopAction,
  WorkshopAvailability,
  WorkshopAvailabilityRequest,
  WorkshopAvailabilityResult,
  WorkshopResource,
  WorkshopResourceFacts,
  WorkshopSubject,
} from "./workshop-access.interface.js";

const MAX_BATCH_SIZE = 100;

export function assembleWorkshopAccess(
  dependencies: WorkshopAccessDependencies,
): WorkshopAccess {
  const clock = dependencies.clock ?? (() => new Date());
  const decisionId = dependencies.decisionId ?? randomUUID;

  return Object.freeze({
    async checkAvailabilityMany(
      request: WorkshopAvailabilityRequest,
    ): Promise<WorkshopAvailabilityResult> {
      if (request.operations.length === 0) {
        return { ok: false, error: { code: "empty_batch" } };
      }
      if (request.operations.length > MAX_BATCH_SIZE) {
        return { ok: false, error: { code: "batch_too_large" } };
      }
      if (
        new Set(request.operations.map(({ itemId }) => itemId)).size !==
        request.operations.length
      ) {
        return { ok: false, error: { code: "duplicate_item_id" } };
      }

      let factsByResource: ReadonlyMap<string, WorkshopResourceFacts>;
      try {
        const facts = await dependencies.resourceFacts.findMany(
          request.operations.map(({ resource }) => resource),
        );
        factsByResource = uniqueFactsByResource(facts);
      } catch {
        factsByResource = new Map();
      }

      return {
        ok: true,
        items: request.operations.map(({ itemId, resource, action }) => ({
          itemId,
          availability: projectAvailability(
            factsByResource.get(resourceKey(resource)),
            resource,
            action,
          ),
        })),
      };
    },

    async authorize(
      request: WorkshopAccessRequest,
    ): Promise<WorkshopAccessDecision> {
      let facts: WorkshopResourceFacts | null;
      try {
        facts = await dependencies.resourceFacts.findOne(request.resource);
      } catch {
        return deny("dependency_unavailable");
      }
      if (facts === null) return deny("resource_not_found");
      if (resourceKey(facts.resource) !== resourceKey(request.resource)) {
        return deny("resource_mismatch");
      }

      const resourceReason = resolveResourceReason(
        facts,
        request.action,
        request.subject,
      );
      if (resourceReason === "public_resource") {
        return allow("public_resource");
      }
      if (resourceReason === "authenticated_account") {
        return allow("authenticated_account");
      }
      if (resourceReason !== undefined) return deny(resourceReason);

      if (request.subject.kind === "anonymous") {
        return deny("authentication_required");
      }
      let entitlement: WorkshopEntitlementState;
      try {
        entitlement = await dependencies.workshopEntitlements.resolveForAccess(
          request.subject.accountId,
        );
      } catch {
        return deny("dependency_unavailable");
      }
      switch (entitlement.kind) {
        case "active":
          return {
            ...metadata(),
            effect: "allow",
            reason: "active_workshop",
            validUntil: entitlement.validUntil,
          };
        case "required":
          return deny("workshop_access_required");
        case "expired":
          return deny("workshop_access_expired");
        case "stale":
          return deny("entitlement_stale");
        case "unavailable":
          return deny("dependency_unavailable");
      }
    },
  });

  function metadata() {
    return {
      decisionId: decisionId(),
      policyVersion: "workshop-access-v1" as const,
      decidedAt: clock().toISOString(),
    };
  }

  function allow(
    reason: "public_resource" | "authenticated_account",
  ): WorkshopAccessDecision {
    return { ...metadata(), effect: "allow", reason };
  }

  function deny(reason: WorkshopAccessDenyReason): WorkshopAccessDecision {
    return { ...metadata(), effect: "deny", reason };
  }
}

function projectAvailability(
  facts: WorkshopResourceFacts | undefined,
  requestedResource: WorkshopResource,
  action: WorkshopAction,
): WorkshopAvailability {
  if (
    facts === undefined ||
    resourceKey(facts.resource) !== resourceKey(requestedResource) ||
    facts.publicationState !== "published" ||
    !isValidAction(facts.resource.kind, action)
  ) {
    return "unavailable";
  }
  return facts.access === "public" ? "public" : "included";
}

function resolveResourceReason(
  facts: WorkshopResourceFacts,
  action: WorkshopAction,
  subject: WorkshopSubject,
):
  | WorkshopAccessDenyReason
  | "public_resource"
  | "authenticated_account"
  | undefined {
  if (!isValidAction(facts.resource.kind, action)) {
    return "resource_action_invalid";
  }
  if (action === "read_progress") {
    return subject.kind === "anonymous"
      ? "authentication_required"
      : "authenticated_account";
  }
  if (facts.publicationState !== "published") {
    return "resource_unpublished";
  }
  if (action === "write_progress" && subject.kind === "anonymous") {
    return "authentication_required";
  }
  if (facts.access === "public") {
    return action === "write_progress"
      ? "authenticated_account"
      : "public_resource";
  }
  return undefined;
}

function isValidAction(
  kind: WorkshopResource["kind"],
  action: WorkshopAction,
): boolean {
  switch (kind) {
    case "track_outline":
    case "production_case":
      return action === "read";
    case "laboratory":
      return action === "read" ||
        action === "read_progress" ||
        action === "write_progress";
    case "laboratory_artifact":
    case "production_case_artifact":
      return action === "read" || action === "download";
  }
}

function uniqueFactsByResource(
  facts: readonly WorkshopResourceFacts[],
): ReadonlyMap<string, WorkshopResourceFacts> {
  const result = new Map<string, WorkshopResourceFacts>();
  const duplicates = new Set<string>();
  for (const item of facts) {
    const key = resourceKey(item.resource);
    if (result.has(key)) duplicates.add(key);
    result.set(key, item);
  }
  for (const duplicate of duplicates) result.delete(duplicate);
  return result;
}

function resourceKey(resource: WorkshopResource): string {
  return `${resource.kind}:${resource.resourceId}`;
}
