import type { AccountId } from "../../../accounts/index.js";
import type {
  MembershipAccessState,
  MembershipEntitlements as MembershipEntitlementsModule,
} from "../../../membership-entitlements/index.js";
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

export type { MembershipAccessState };
export type MembershipEntitlements = Pick<
  MembershipEntitlementsModule,
  "resolveForAccess"
>;

export interface ContentAccessDependencies {
  readonly materialResourceFacts: MaterialResourceFactsAdapter;
  readonly accountPermissions: AccountPermissions;
  readonly membershipEntitlements: MembershipEntitlements;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}
