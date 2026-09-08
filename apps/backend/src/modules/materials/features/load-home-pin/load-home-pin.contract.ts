import type { Result } from "../../result.js";
import type { ForbiddenError, SystemError } from "../../facets/material-authoring/material-authoring.contract.js";

export interface HomePinDto {
  readonly seriesId: string | null;
  readonly version: number;
}
export type LoadHomePinOperation = (query: { readonly actor: string }) => Promise<Result<HomePinDto, ForbiddenError | SystemError>>;
