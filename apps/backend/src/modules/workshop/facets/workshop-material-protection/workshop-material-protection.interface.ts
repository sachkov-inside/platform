import type { MaterialId } from "../../../materials/index.js";

export type WorkshopMaterialProtectionState =
  | "protected"
  | "unprotected"
  | "unavailable";

export interface WorkshopMaterialProtection {
  resolve(materialId: MaterialId): Promise<WorkshopMaterialProtectionState>;
}
