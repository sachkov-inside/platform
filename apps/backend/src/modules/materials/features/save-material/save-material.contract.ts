import type { PublicationState } from "../../domain/material.js";
import type { MaterialMetadataValidationError } from "../../domain/material-metadata.js";
import type {
  ForbiddenError,
  GuideRemovalConfirmationRequiredError,
  IdempotencyError,
  InvalidPublicationTransitionError,
  InvalidReferenceError,
  MaterialMetadataSelectionInput,
  MaterialMutationReceiptDto,
  MaterialNotFoundError,
  SeriesOrdinalConflictError,
  StaleContentVersionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

/** One Save names at most this many Videos the author removed since the previous Save. */
export const MATERIAL_DETACHED_VIDEOS_MAX = 100;

export interface SaveMaterialCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly expectedContentVersion: number;
  readonly publicationState: PublicationState;
  readonly primaryVideoId?: string | null;
  readonly deleteVideoId?: string | null;
  /** Videos the author removed from this Material; none of them may return as its upload. */
  readonly detachVideoIds?: readonly string[];
  readonly metadata: MaterialMetadataSelectionInput;
  readonly body: unknown;
  /** Руководства с держателями права, снятие опубликованного материала из которых подтверждено. */
  readonly confirmedGuideRemovals?: readonly string[] | undefined;
}

export type SaveMaterialError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | GuideRemovalConfirmationRequiredError
  | MaterialNotFoundError
  | StaleContentVersionError
  | InvalidPublicationTransitionError
  | InvalidReferenceError
  | SeriesOrdinalConflictError
  | IdempotencyError
  | SystemError;
export type SaveMaterialResult = Result<
  MaterialMutationReceiptDto,
  SaveMaterialError
>;
export type SaveMaterialOperation = (
  command: SaveMaterialCommand,
) => Promise<SaveMaterialResult>;
