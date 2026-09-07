import { z } from "zod";
import type { ReadingState } from "../../domain/reading-state.js";

export const setReadingStateSchema = z.object({
  isRead: z.boolean(),
  expectedVersion: z.number().int().nonnegative().max(2_147_483_646),
  commandId: z.uuid(),
}).strict();
export type SetReadingStateCommand = z.infer<typeof setReadingStateSchema> & {
  readonly accountId: string;
  readonly materialId: string;
};
export type SetReadingStateError =
  | { readonly code: "invalid_request" }
  | { readonly code: "access_denied" }
  | { readonly code: "access_changed" }
  | { readonly code: "command_conflict" }
  | { readonly code: "stale_version"; readonly current: ReadingState }
  | { readonly code: "dependency_unavailable" };
export type SetReadingStateResult =
  | { readonly ok: true; readonly value: { readonly state: ReadingState; readonly changed: boolean; readonly replayed: boolean } }
  | { readonly ok: false; readonly error: SetReadingStateError };
