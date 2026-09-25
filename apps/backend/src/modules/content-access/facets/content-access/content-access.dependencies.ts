import type { AccountId } from "../../../accounts/index.js";
import type { MaterialId } from "../../../../infrastructure/contracts/material-id.js";

export interface MaterialResourceFacts {
  readonly materialId: MaterialId;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly access: "free" | "membership" | "workshop";
  readonly contentVersion: number;
  readonly primaryVideoId: string | null;
  readonly guideIds?: readonly string[];
}

export interface MaterialResourceFactsAdapter {
  findMany(
    materialIds: readonly MaterialId[],
  ): Promise<readonly MaterialResourceFacts[]>;
  findOne(materialId: MaterialId): Promise<MaterialResourceFacts | null>;
}

export interface AssetResourceFacts {
  readonly assetId: string;
  readonly kind: "file" | "image";
  readonly materialId: MaterialId;
}

export interface AssetResourceFactsAdapter {
  findMany(assetIds: readonly string[]): Promise<readonly AssetResourceFacts[]>;
  findOne(assetId: string): Promise<AssetResourceFacts | null>;
}

export interface GuideArtifactResourceFacts {
  readonly access: "free" | "membership";
  readonly archived: boolean;
  readonly artifactId: string;
  readonly guideIds: readonly string[];
  readonly version: number;
}

export interface GuideArtifactResourceFactsAdapter {
  findMany(
    artifactIds: readonly string[],
  ): Promise<readonly GuideArtifactResourceFacts[]>;
  findOne(artifactId: string): Promise<GuideArtifactResourceFacts | null>;
}

export interface VideoResourceFacts {
  readonly videoId: string;
  readonly materialId: MaterialId;
  readonly access: "free" | "membership" | "workshop";
}

export interface VideoResourceFactsAdapter {
  findMany(videoIds: readonly string[]): Promise<readonly VideoResourceFacts[]>;
  findOne(videoId: string): Promise<VideoResourceFacts | null>;
}

export interface AccountPermissions {
  hasMaterialsManage(accountId: AccountId): Promise<boolean>;
}

/** Workshop access to one Material; Workshop answers it. */
export type WorkshopMaterialAccessState =
  | Readonly<{ availability: "available"; validUntil: string }>
  | Readonly<{ availability: "locked" | "unavailable" }>;

/** The Workshop decision Content Access needs. Workshop implements this port. */
export interface WorkshopMaterialAccess {
  resolve(accountId: AccountId, materialId: MaterialId): Promise<WorkshopMaterialAccessState>;
}

/** A Membership decision for one resource; Membership Entitlements answers it. */
export type MembershipAccessState =
  | Readonly<{ kind: "active"; validUntil: string | null }>
  | Readonly<{ kind: "required" | "expired" | "stale" | "unavailable" }>;

/** The Membership decisions Content Access needs. Membership Entitlements implements this port. */
export interface MembershipEntitlements {
  resolveManyForAccess?(
    accountId: AccountId,
    resources: readonly { guideIds: readonly string[]; materialId?: string | undefined }[],
  ): Promise<readonly MembershipAccessState[]>;
  resolveForAccess(accountId: AccountId, guideIds?: readonly string[], materialId?: string): Promise<MembershipAccessState>;
}

export interface ContentAccessDependencies {
  readonly assetResourceFacts?: AssetResourceFactsAdapter;
  readonly guideArtifactResourceFacts?: GuideArtifactResourceFactsAdapter;
  readonly videoResourceFacts?: VideoResourceFactsAdapter;
  readonly materialResourceFacts: MaterialResourceFactsAdapter;
  readonly accountPermissions: AccountPermissions;
  readonly membershipEntitlements: MembershipEntitlements;
  readonly workshopMaterialAccess?: WorkshopMaterialAccess;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}
