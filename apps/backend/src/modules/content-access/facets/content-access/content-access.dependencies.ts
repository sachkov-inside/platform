import type { AccountId } from "../../../accounts/index.js";
import type { MaterialId } from "../../../../infrastructure/contracts/material-id.js";

export interface MaterialResourceFacts {
  readonly materialId: MaterialId;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly access: "free" | "closed";
  readonly contentVersion: number;
  readonly primaryVideoId: string | null;
  readonly productIds?: readonly string[];
  /** All published Product placements are archived; reading requires one of those Product rights. */
  readonly archivedOnly?: boolean;
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

export interface ProductArtifactResourceFacts {
  readonly access: "free" | "closed";
  readonly archived: boolean;
  readonly artifactId: string;
  readonly productIds: readonly string[];
  readonly version: number;
}

export interface ProductArtifactResourceFactsAdapter {
  findMany(
    artifactIds: readonly string[],
  ): Promise<readonly ProductArtifactResourceFacts[]>;
  findOne(artifactId: string): Promise<ProductArtifactResourceFacts | null>;
}

/** What Content Access needs to decide on a Product Task; Product Tasks implement this port. */
export interface ProductTaskResourceFacts {
  readonly taskId: string;
  readonly access: "free" | "closed";
  readonly productId: string;
  readonly published: boolean;
  /** The current Task Version number. */
  readonly version: number;
}

export interface ProductTaskResourceFactsAdapter {
  findMany(
    taskIds: readonly string[],
  ): Promise<readonly ProductTaskResourceFacts[]>;
  findOne(taskId: string): Promise<ProductTaskResourceFacts | null>;
}

export interface VideoResourceFacts {
  readonly videoId: string;
  readonly materialId: MaterialId;
  readonly access: "free" | "closed";
}

export interface VideoResourceFactsAdapter {
  findMany(videoIds: readonly string[]): Promise<readonly VideoResourceFacts[]>;
  findOne(videoId: string): Promise<VideoResourceFacts | null>;
}

export interface AccountPermissions {
  hasMaterialsManage(accountId: AccountId): Promise<boolean>;
}

/** A Membership decision for one resource; Membership Entitlements answers it. */
export type MembershipAccessState =
  | Readonly<{ kind: "active"; validUntil: string | null }>
  | Readonly<{ kind: "required" | "expired" | "stale" | "unavailable" }>;

/** The Membership decisions Content Access needs. Membership Entitlements implements this port. */
export interface AccountRights {
  resolveManyForAccess?(
    accountId: AccountId,
    resources: readonly {
      productIds: readonly string[];
      materialId?: string | undefined;
    }[],
  ): Promise<readonly MembershipAccessState[]>;
  resolveForAccess(
    accountId: AccountId,
    productIds?: readonly string[],
    materialId?: string,
  ): Promise<MembershipAccessState>;
}

export interface ContentAccessDependencies {
  readonly assetResourceFacts?: AssetResourceFactsAdapter;
  readonly productArtifactResourceFacts?: ProductArtifactResourceFactsAdapter;
  readonly productTaskResourceFacts?: ProductTaskResourceFactsAdapter;
  readonly videoResourceFacts?: VideoResourceFactsAdapter;
  readonly materialResourceFacts: MaterialResourceFactsAdapter;
  readonly accountPermissions: AccountPermissions;
  readonly accountRights: AccountRights;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}
