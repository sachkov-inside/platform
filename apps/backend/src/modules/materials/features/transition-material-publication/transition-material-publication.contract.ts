import type { PublicationState } from "../../domain/material.js";
import type { MaterialMutationReceiptDto } from "../../facets/material-authoring/material-authoring.contract.js";
import type { LoadMaterialError } from "../load-material/load-material.contract.js";
import type { SaveMaterialError } from "../save-material/save-material.contract.js";
import type { Result } from "../../result.js";

export interface TransitionMaterialPublicationCommand {
  readonly actor: string;
  readonly expectedContentVersion: number;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly publicationState: Exclude<PublicationState, "draft">;
}

export type TransitionMaterialPublicationError =
  | LoadMaterialError
  | SaveMaterialError;

export type TransitionMaterialPublicationOperation = (
  command: TransitionMaterialPublicationCommand,
) => Promise<Result<MaterialMutationReceiptDto, TransitionMaterialPublicationError>>;
