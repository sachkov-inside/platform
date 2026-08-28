import type { AccountId } from "../../../accounts/index.js";
import type { MaterialId } from "../../../materials/index.js";

export interface MaterialResourceFacts {
  readonly materialId: MaterialId;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly access: "free" | "membership";
  readonly contentVersion: number;
}

export interface MaterialResourceFactsAdapter {
  findMany(
    materialIds: readonly MaterialId[],
  ): Promise<readonly MaterialResourceFacts[]>;
  findOne(materialId: MaterialId): Promise<MaterialResourceFacts | null>;
}

export interface AccountPermissions {
  hasMaterialsManage(accountId: AccountId): Promise<boolean>;
}

export type MembershipAccessState =
  | Readonly<{ kind: "active"; validUntil: string }>
  | Readonly<{
      kind: "required" | "expired" | "stale" | "unavailable";
    }>;

export interface MembershipEntitlements {
  resolveForAccess(accountId: AccountId): Promise<MembershipAccessState>;
}

export interface ContentAccessDependencies {
  readonly materialResourceFacts: MaterialResourceFactsAdapter;
  readonly accountPermissions: AccountPermissions;
  readonly membershipEntitlements: MembershipEntitlements;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}
