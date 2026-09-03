import type { AccountId } from "../../../accounts/index.js";
import type { MaterialId } from "../../../materials/index.js";

export type WorkshopMaterialAccessState =
  | Readonly<{ availability: "available"; validUntil: string }>
  | Readonly<{ availability: "locked" | "unavailable" }>;

export interface WorkshopMaterialAccess {
  resolve(
    accountId: AccountId,
    materialId: MaterialId,
  ): Promise<WorkshopMaterialAccessState>;
}
