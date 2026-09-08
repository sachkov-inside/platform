import type { Result } from "../../result.js";
import type { ForbiddenError, InvalidContentError, InvalidReferenceError, MaterialNotFoundError, SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { HomePinDto } from "../load-home-pin/load-home-pin.contract.js";

export interface SetHomePinCommand {
  readonly actor: string;
  readonly materialId: string | null;
  readonly expectedVersion: number;
}
export type SetHomePinError = ForbiddenError | InvalidContentError | InvalidReferenceError | MaterialNotFoundError | SystemError | { readonly code: "stale_home_pin" };
export type SetHomePinOperation = (command: SetHomePinCommand) => Promise<Result<HomePinDto, SetHomePinError>>;
