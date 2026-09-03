import type { AccountId } from "../../../accounts/index.js";
import type {
  MembershipAccessState,
  MembershipEntitlements as MembershipEntitlementsModule,
} from "../../../membership-entitlements/index.js";
import type { MaterialId } from "../../../materials/index.js";
import type { WorkshopMaterialAccess } from "../../../workshop/index.js";

export interface MaterialResourceFacts {
  readonly materialId: MaterialId;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly access: "free" | "membership" | "workshop";
  readonly contentVersion: number;
  readonly primaryVideoId: string | null;
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

export type { MembershipAccessState };
export type MembershipEntitlements = Pick<
  MembershipEntitlementsModule,
  "resolveForAccess"
>;

export interface ContentAccessDependencies {
  readonly assetResourceFacts?: AssetResourceFactsAdapter;
  readonly videoResourceFacts?: VideoResourceFactsAdapter;
  readonly materialResourceFacts: MaterialResourceFactsAdapter;
  readonly accountPermissions: AccountPermissions;
  readonly membershipEntitlements: MembershipEntitlements;
  readonly workshopMaterialAccess?: WorkshopMaterialAccess;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}
