import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type {
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { HomePinDto } from "../load-home-pin/load-home-pin.contract.js";

export interface SetHomePinCommand {
  readonly actor: string;
  readonly seriesId: string | null;
  readonly expectedVersion: number;
}
export type SetHomePinError =
  | ForbiddenError
  | InvalidContentError
  | InvalidReferenceError
  | SystemError
  | { readonly code: "stale_home_pin" };
export type SetHomePinOperation = (
  command: SetHomePinCommand,
) => Promise<Result<HomePinDto, SetHomePinError>>;
