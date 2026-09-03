import type { AccountId } from "../../accounts/index.js";

export interface WorkshopOwnerPolicy {
  canManageWorkshop(accountId: AccountId): Promise<boolean>;
}
