import { randomUUID } from "node:crypto";

import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";

import type {
  AccessAction,
  AccessAvailability,
  AccessBatchRequest,
  AccessDecision,
  AccessRequest,
  AvailabilityBatchResult,
  ContentAccess,
  DenyReason,
  ProductAccess,
  ProductAccessRequest,
  Resource,
  Subject,
} from "./content-access.interface.js";
import type {
  ContentAccessDependencies,
  ProductArtifactResourceFacts,
  ProductTaskResourceFacts,
  MaterialResourceFacts,
  MembershipAccessState,
} from "./content-access.dependencies.js";

const MAX_BATCH_SIZE = 100;

interface SubjectFacts {
  readonly permission: "granted" | "denied" | "unavailable";
  readonly membership?: MembershipAccessState;
}

interface ResolvedResourceFacts {
  readonly access: MaterialResourceFacts["access"];
  readonly contentVersion: number;
  readonly productIds?: readonly string[];
  readonly archivedOnly?: boolean;
  /** Absent for resources that no Material owns, such as a Product Artifact. */
  readonly materialId?: MaterialResourceFacts["materialId"];
  readonly publicationState: MaterialResourceFacts["publicationState"];
  readonly resourceKey: string;
  readonly resourceKind:
    | "file_asset"
    | "product_artifact"
    | "product_task"
    | "image_asset"
    | "material"
    | "video";
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
      } catch (error) {
        return dependencyFailure(
          { module: "content-access", operation: "checkAvailabilityMany" },
          error,
          {
            ok: true,
            items: input.operations.map(({ itemId }) => ({
              itemId,
              availability: "unavailable" as const,
            })),
          },
        );
      }
      const requiredResources = [...resourcesByKey].filter(([key, facts]) =>
        input.operations.some(
          (operation) =>
            resourceKey(operation.resource) === key &&
            needsSubjectFacts(facts, operation.action),
        ),
      );
      const subjectFactsByResource = new Map<
        string,
        SubjectFacts | undefined
      >();
      if (requiredResources.length > 0) {
        const permission = await resolveSubjectFacts(
          dependencies,
          input.subject,
          false,
        );
        for (const [key] of requiredResources)
          subjectFactsByResource.set(key, permission);
        const membershipResources = requiredResources.filter(
          ([key, facts]) =>
            (facts.archivedOnly === true ||
              permission?.permission === "denied") &&
            input.operations.some(
              (operation) =>
                resourceKey(operation.resource) === key &&
                needsMembership(facts, operation.action),
            ),
        );
        if (
          input.subject.kind === "account" &&
          membershipResources.length > 0
        ) {
          const accountId = input.subject.accountId;
          let memberships: readonly MembershipAccessState[];
          const resources = membershipResources.map(([, facts]) => ({
            productIds: facts.productIds ?? [],
            materialId:
              facts.archivedOnly === true ? undefined : facts.materialId,
          }));
          try {
            memberships =
              dependencies.accountRights.resolveManyForAccess === undefined
                ? await Promise.all(
                    resources.map((resource) =>
                      dependencies.accountRights.resolveForAccess(
                        accountId,
                        resource.productIds,
                        resource.materialId,
                      ),
                    ),
                  )
                : await dependencies.accountRights.resolveManyForAccess(
                    accountId,
                    resources,
                  );
          } catch (error) {
            reportDependencyFailure(
              { module: "content-access", operation: "checkAvailabilityMany" },
              error,
            );
            memberships = [];
          }
          membershipResources.forEach(([key], index) =>
            subjectFactsByResource.set(key, {
              permission: permission?.permission ?? "unavailable",
              membership: memberships[index] ?? { kind: "unavailable" },
            }),
          );
        }
      }

      return {
        ok: true,
        items: input.operations.map(({ itemId, resource, action }) => ({
          itemId,
          availability: projectAvailability(
            resourcesByKey.get(resourceKey(resource)),
            action,
            input.subject,
            subjectFactsByResource.get(resourceKey(resource)),
          ),
        })),
      };
    },

    async authorize(input: AccessRequest): Promise<AccessDecision> {
      let facts: ResolvedResourceFacts | null;
      try {
        facts = await resolveOneResourceFacts(dependencies, input.resource);
      } catch (error) {
        return dependencyFailure(
          { module: "content-access", operation: "authorize" },
          error,
          decision("dependency_unavailable"),
        );
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
        facts.productIds,
        facts.archivedOnly === true ? undefined : facts.materialId,
        input.action !== "preview" && facts.archivedOnly === true,
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

    // Разрешение автора здесь не читается: оно открывает материалы для работы, а не продукт
    // читателю, и не должно прятать от автора покупку.
    async checkProductAccess({
      subject,
      productId,
    }: ProductAccessRequest): Promise<ProductAccess> {
      if (subject.kind === "anonymous") return { kind: "closed" };
      let membership: MembershipAccessState;
      try {
        membership = await dependencies.accountRights.resolveForAccess(
          subject.accountId,
          [productId],
        );
      } catch (error) {
        return dependencyFailure(
          { module: "content-access", operation: "checkProductAccess" },
          error,
          { kind: "unavailable" },
        );
      }
      switch (membership.kind) {
        case "active":
          return { kind: "open" };
        case "required":
        case "expired":
          return { kind: "closed" };
        case "stale":
        case "unavailable":
          return { kind: "unavailable" };
      }
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
  productIds: readonly string[] = [],
  materialId?: string,
  readerOnly = false,
): Promise<SubjectFacts | undefined> {
  if (subject.kind === "anonymous") {
    return undefined;
  }
  let managesMaterials: boolean;
  try {
    managesMaterials =
      !readerOnly &&
      (await dependencies.accountPermissions.hasMaterialsManage(
        subject.accountId,
      ));
  } catch (error) {
    return dependencyFailure(
      { module: "content-access", operation: "resolveSubjectFacts" },
      error,
      { permission: "unavailable" },
    );
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
      membership: await dependencies.accountRights.resolveForAccess(
        subject.accountId,
        productIds,
        materialId,
      ),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "content-access", operation: "resolveSubjectFacts" },
      error,
      {
        permission: "denied",
        membership: { kind: "unavailable" },
      },
    );
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
  return (
    (action === "read" || action === "download" || action === "play") &&
    facts.publicationState === "published" &&
    (facts.access === "closed" || facts.archivedOnly === true)
  );
}

function projectAvailability(
  facts: ResolvedResourceFacts | undefined,
  action: AccessAction,
  subject: Subject,
  subjectFacts: SubjectFacts | undefined,
): AccessAvailability["availability"] {
  if (facts === undefined) return "unavailable";
  if (facts.publicationState !== "published") {
    // Only its author still opens an unpublished Product Task; for everyone else it does not exist.
    return facts.resourceKind === "product_task" &&
      evaluate(facts, action, subject, subjectFacts) === "materials_manager"
      ? "available"
      : "unavailable";
  }
  const reason = evaluate(facts, action, subject, subjectFacts);
  if (
    reason === "public_resource" ||
    reason === "materials_manager" ||
    reason === "active_membership"
  ) {
    return "available";
  }
  if (reason === "resource_action_invalid" || reason === "resource_not_found") {
    return "unavailable";
  }
  return facts.access === "closed" ? "locked" : "unavailable";
}

function evaluate(
  facts: ResolvedResourceFacts,
  action: AccessAction,
  subject: Subject,
  subjectFacts: SubjectFacts | undefined,
): DenyReason | "public_resource" | "materials_manager" | "active_membership" {
  const resource = resourceReason(facts, action);
  if (resource !== undefined) {
    return resource;
  }
  if (facts.archivedOnly === true && action !== "preview") {
    if (subject.kind === "anonymous") return "resource_not_found";
    switch (subjectFacts?.membership?.kind) {
      case "active":
        return "active_membership";
      case "required":
      case "expired":
        return "resource_not_found";
      case "stale":
      case "unavailable":
      case undefined:
        return "dependency_unavailable";
    }
  }
  if (subject.kind === "anonymous") {
    return "authentication_required";
  }
  if (
    subjectFacts?.permission === "unavailable" ||
    subjectFacts === undefined
  ) {
    return "dependency_unavailable";
  }
  if (subjectFacts.permission === "granted") {
    return "materials_manager";
  }
  if (action === "preview") {
    return "permission_required";
  }
  // A read of an unpublished resource reaches here only for a Product Task, past its author.
  if (facts.publicationState !== "published") {
    return "resource_unpublished";
  }
  switch (subjectFacts.membership?.kind) {
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
  const validPair =
    action === "preview" ||
    (facts.resourceKind === "material" && action === "read") ||
    (facts.resourceKind === "image_asset" && action === "read") ||
    (facts.resourceKind === "file_asset" && action === "download") ||
    (facts.resourceKind === "product_artifact" && action === "download") ||
    (facts.resourceKind === "product_task" && action === "read") ||
    (facts.resourceKind === "video" && action === "play");
  if (!validPair) {
    return "resource_action_invalid";
  }
  if (
    (action === "read" || action === "download" || action === "play") &&
    facts.publicationState !== "published"
  ) {
    // The author of an unpublished Product Task still reads it, so the subject decides.
    return facts.resourceKind === "product_task"
      ? undefined
      : "resource_unpublished";
  }
  if (
    (action === "read" || action === "download" || action === "play") &&
    facts.access === "free" &&
    facts.archivedOnly !== true
  ) {
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
      : resolveMaterialFacts(
          material,
          "material",
          `material:${material.materialId}`,
        );
  }
  if (resource.kind === "video") {
    const video =
      (await dependencies.videoResourceFacts?.findOne(resource.videoId)) ??
      null;
    if (video === null) return null;
    const material = await dependencies.materialResourceFacts.findOne(
      video.materialId,
    );
    if (material === null) return null;
    return resolveMaterialFacts(
      material,
      "video",
      video.access === material.access &&
        material.primaryVideoId === video.videoId
        ? `video:${video.videoId}`
        : `video-mismatch:${video.videoId}`,
    );
  }
  if (resource.kind === "productArtifact") {
    const artifact =
      (await dependencies.productArtifactResourceFacts?.findOne(
        resource.artifactId,
      )) ?? null;
    return artifact === null ? null : resolveProductArtifactFacts(artifact);
  }
  if (resource.kind === "productTask") {
    const task =
      (await dependencies.productTaskResourceFacts?.findOne(resource.taskId)) ??
      null;
    return task === null ? null : resolveProductTaskFacts(task);
  }
  const asset =
    (await dependencies.assetResourceFacts?.findOne(resource.assetId)) ?? null;
  if (asset === null) return null;
  const material = await dependencies.materialResourceFacts.findOne(
    asset.materialId,
  );
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
  const assetIds = [
    ...new Set(
      resources.flatMap((resource) =>
        resource.kind === "asset" ? [resource.assetId] : [],
      ),
    ),
  ];
  const assets =
    assetIds.length === 0
      ? []
      : ((await dependencies.assetResourceFacts?.findMany(assetIds)) ?? []);
  const artifactIds = [
    ...new Set(
      resources.flatMap((resource) =>
        resource.kind === "productArtifact" ? [resource.artifactId] : [],
      ),
    ),
  ];
  const artifacts =
    artifactIds.length === 0
      ? []
      : ((await dependencies.productArtifactResourceFacts?.findMany(
          artifactIds,
        )) ?? []);
  const artifactsById = new Map(
    artifacts.map((facts) => [facts.artifactId, facts]),
  );
  const taskIds = [
    ...new Set(
      resources.flatMap((resource) =>
        resource.kind === "productTask" ? [resource.taskId] : [],
      ),
    ),
  ];
  const tasks =
    taskIds.length === 0
      ? []
      : ((await dependencies.productTaskResourceFacts?.findMany(taskIds)) ??
        []);
  const tasksById = new Map(tasks.map((facts) => [facts.taskId, facts]));
  const videoIds = [
    ...new Set(
      resources.flatMap((resource) =>
        resource.kind === "video" ? [resource.videoId] : [],
      ),
    ),
  ];
  const videos =
    videoIds.length === 0
      ? []
      : ((await dependencies.videoResourceFacts?.findMany(videoIds)) ?? []);
  const materialIds = [
    ...new Set([
      ...resources.flatMap((resource) =>
        resource.kind === "material" ? [resource.materialId] : [],
      ),
      ...assets.map(({ materialId }) => materialId),
      ...videos.map(({ materialId }) => materialId),
    ]),
  ];
  // A batch may now carry only Product Artifacts, which no Material owns.
  const materials =
    materialIds.length === 0
      ? []
      : await dependencies.materialResourceFacts.findMany(materialIds);
  const materialsById = new Map(
    materials.map((facts) => [facts.materialId, facts]),
  );
  const assetsById = new Map(assets.map((facts) => [facts.assetId, facts]));
  const videosById = new Map(videos.map((facts) => [facts.videoId, facts]));
  return new Map(
    resources.flatMap(
      (resource): readonly [string, ResolvedResourceFacts][] => {
        if (resource.kind === "material") {
          const material = materialsById.get(resource.materialId);
          return material === undefined
            ? []
            : [
                [
                  resourceKey(resource),
                  resolveMaterialFacts(
                    material,
                    "material",
                    resourceKey(resource),
                  ),
                ],
              ];
        }
        if (resource.kind === "video") {
          const video = videosById.get(resource.videoId);
          const material =
            video === undefined
              ? undefined
              : materialsById.get(video.materialId);
          return video === undefined ||
            material === undefined ||
            video.access !== material.access ||
            material.primaryVideoId !== video.videoId
            ? []
            : [
                [
                  resourceKey(resource),
                  resolveMaterialFacts(
                    material,
                    "video",
                    resourceKey(resource),
                  ),
                ],
              ];
        }
        if (resource.kind === "productArtifact") {
          const artifact = artifactsById.get(resource.artifactId);
          return artifact === undefined
            ? []
            : [[resourceKey(resource), resolveProductArtifactFacts(artifact)]];
        }
        if (resource.kind === "productTask") {
          const task = tasksById.get(resource.taskId);
          return task === undefined
            ? []
            : [[resourceKey(resource), resolveProductTaskFacts(task)]];
        }
        const asset = assetsById.get(resource.assetId);
        const material =
          asset === undefined ? undefined : materialsById.get(asset.materialId);
        return asset === undefined || material === undefined
          ? []
          : [
              [
                resourceKey(resource),
                resolveMaterialFacts(
                  material,
                  asset.kind === "file" ? "file_asset" : "image_asset",
                  `asset:${asset.assetId}`,
                ),
              ],
            ];
      },
    ),
  );
}

function resolveMaterialFacts(
  material: MaterialResourceFacts,
  resourceKind: ResolvedResourceFacts["resourceKind"],
  resourceKeyValue: string,
): ResolvedResourceFacts {
  return { ...material, resourceKey: resourceKeyValue, resourceKind };
}

function resolveProductArtifactFacts(
  artifact: ProductArtifactResourceFacts,
): ResolvedResourceFacts {
  return {
    access: artifact.access,
    contentVersion: artifact.version,
    productIds: artifact.productIds,
    publicationState: artifact.archived ? "unpublished" : "published",
    resourceKey: `product-artifact:${artifact.artifactId}`,
    resourceKind: "product_artifact",
  };
}

function resolveProductTaskFacts(
  task: ProductTaskResourceFacts,
): ResolvedResourceFacts {
  return {
    access: task.access,
    contentVersion: task.version,
    productIds: [task.productId],
    publicationState: task.published ? "published" : "unpublished",
    resourceKey: `product-task:${task.taskId}`,
    resourceKind: "product_task",
  };
}

function resourceKey(resource: Resource): string {
  if (resource.kind === "material") return `material:${resource.materialId}`;
  if (resource.kind === "video") return `video:${resource.videoId}`;
  if (resource.kind === "productArtifact") {
    return `product-artifact:${resource.artifactId}`;
  }
  if (resource.kind === "productTask") return `product-task:${resource.taskId}`;
  return `asset:${resource.assetId}`;
}
