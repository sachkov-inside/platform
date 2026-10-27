import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type {
  ForbiddenError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";

export interface HomePinDto {
  readonly productId: string | null;
  readonly version: number;
}
export type LoadHomePinOperation = (query: {
  readonly actor: string;
}) => Promise<Result<HomePinDto, ForbiddenError | SystemError>>;
