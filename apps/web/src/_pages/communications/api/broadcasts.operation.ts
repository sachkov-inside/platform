import { z } from "zod";

import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  broadcastActionInputSchema,
  broadcastResultSchema,
  broadcastSaveInputSchema,
  savedPostActionSchema,
  savedPostSampleSchema,
  savedPostSaveSchema,
  templateResultSchema,
} from "../model/broadcasts";

/** A refused session or right asks to sign in; a malformed answer is reported as such. */
function broadcastsFailure(failure: MutationTransportFailure) {
  return {
    kind: "error",
    code:
      failure.kind === "contract"
        ? "invalid_response"
        : failure.status === 401 || failure.status === 403
          ? "authentication_required"
          : "provider_unavailable",
  } as const;
}

/** Saves a broadcast draft at the revision the author edited. */
export const saveBroadcastOperation = defineMutationOperation({
  input: broadcastSaveInputSchema,
  method: "POST",
  path: "/api/communications/broadcasts/save",
  result: broadcastResultSchema,
  transportFailure: broadcastsFailure,
});

/** Launches a broadcast. */
export const launchBroadcastOperation = defineMutationOperation({
  input: broadcastActionInputSchema,
  method: "POST",
  path: "/api/communications/broadcasts/launch",
  result: broadcastResultSchema,
  transportFailure: broadcastsFailure,
});

/** Pauses a running broadcast. */
export const pauseBroadcastOperation = defineMutationOperation({
  input: broadcastActionInputSchema,
  method: "POST",
  path: "/api/communications/broadcasts/pause",
  result: broadcastResultSchema,
  transportFailure: broadcastsFailure,
});

/** Resumes a paused broadcast. */
export const resumeBroadcastOperation = defineMutationOperation({
  input: broadcastActionInputSchema,
  method: "POST",
  path: "/api/communications/broadcasts/resume",
  result: broadcastResultSchema,
  transportFailure: broadcastsFailure,
});

/** Cancels a broadcast. */
export const cancelBroadcastOperation = defineMutationOperation({
  input: broadcastActionInputSchema,
  method: "POST",
  path: "/api/communications/broadcasts/cancel",
  result: broadcastResultSchema,
  transportFailure: broadcastsFailure,
});

/** Resolves a saved post reference into broadcast content. */
export const resolveBroadcastTemplateOperation = defineMutationOperation({
  input: z.object({ reference: z.string(), operationId: z.guid() }),
  method: "POST",
  path: "/api/communications/broadcasts/templates/resolve",
  result: templateResultSchema,
  transportFailure: broadcastsFailure,
});

/** Saves a post to the library. */
export const savePostOperation = defineMutationOperation({
  input: savedPostSaveSchema,
  method: "POST",
  path: "/api/communications/templates/save",
  result: templateResultSchema,
  transportFailure: broadcastsFailure,
});

/** Sends a saved post to the author as a sample. */
export const samplePostOperation = defineMutationOperation({
  input: savedPostActionSchema,
  method: "POST",
  path: "/api/communications/templates/sample",
  result: savedPostSampleSchema,
  transportFailure: broadcastsFailure,
});
