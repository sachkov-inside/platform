import { z } from "zod";

import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  commandSchema,
  deliveryListSchema,
  funnelListSchema,
  funnelSchema,
  introSchema,
  lifecycleSchema,
  previewSchema,
  resolveDeliverySchema,
  resultSchema,
  saveIntroSchema,
  saveSchema,
  templateReferenceSchema,
  templateSchema,
  type Failure,
} from "../model/communications";

/** A refused session or right keeps its own message; every other failure leaves the write unconfirmed. */
function communicationsFailure(failure: MutationTransportFailure): Failure {
  return {
    kind: "error",
    code:
      failure.kind === "status" && failure.status === 401
        ? "unauthorized"
        : failure.kind === "status" && failure.status === 403
          ? "forbidden"
          : "unavailable",
  };
}

/** Reads one page of the author's Funnels. */
export const listFunnelsOperation = defineMutationOperation({
  input: z.object({ cursor: z.string().optional() }),
  method: "POST",
  path: "/api/communications/funnels/list",
  result: resultSchema(funnelListSchema),
  transportFailure: communicationsFailure,
});

/** Reads one Funnel. */
export const readFunnelOperation = defineMutationOperation({
  input: z.object({ funnelId: z.guid() }),
  method: "POST",
  path: "/api/communications/funnels/read",
  result: resultSchema(funnelSchema),
  transportFailure: communicationsFailure,
});

/** Saves a Funnel draft at the revision the author edited. */
export const saveFunnelOperation = defineMutationOperation({
  input: saveSchema,
  method: "POST",
  path: "/api/communications/funnels/save",
  result: resultSchema(funnelSchema),
  transportFailure: communicationsFailure,
});

/** Previews what publishing the Funnel draft changes. */
export const previewFunnelOperation = defineMutationOperation({
  input: commandSchema,
  method: "POST",
  path: "/api/communications/funnels/preview",
  result: resultSchema(previewSchema),
  transportFailure: communicationsFailure,
});

/** Publishes the Funnel draft. */
export const publishFunnelOperation = defineMutationOperation({
  input: commandSchema,
  method: "POST",
  path: "/api/communications/funnels/publish",
  result: resultSchema(funnelSchema),
  transportFailure: communicationsFailure,
});

/** Pauses, resumes, archives or restores a Funnel. */
export const changeFunnelLifecycleOperation = defineMutationOperation({
  input: lifecycleSchema,
  method: "POST",
  path: "/api/communications/funnels/lifecycle",
  result: resultSchema(funnelSchema),
  transportFailure: communicationsFailure,
});

/** Reads the bot intro. */
export const readIntroOperation = defineMutationOperation({
  input: z.object({}),
  method: "POST",
  path: "/api/communications/intro/read",
  result: resultSchema(introSchema),
  transportFailure: communicationsFailure,
});

/** Saves the bot intro at the revision the author edited. */
export const saveIntroOperation = defineMutationOperation({
  input: saveIntroSchema,
  method: "POST",
  path: "/api/communications/intro/save",
  result: resultSchema(introSchema),
  transportFailure: communicationsFailure,
});

/** Reads one page of a Funnel's deliveries. */
export const readDeliveriesOperation = defineMutationOperation({
  input: z.object({ funnelId: z.guid(), cursor: z.string().optional() }),
  method: "POST",
  path: "/api/communications/deliveries/read",
  result: resultSchema(deliveryListSchema),
  transportFailure: communicationsFailure,
});

/** Skips an unconfirmed delivery part. */
export const skipDeliveryOperation = defineMutationOperation({
  input: resolveDeliverySchema,
  method: "POST",
  path: "/api/communications/deliveries/skip",
  result: resultSchema(
    z.object({
      deliveryId: z.guid(),
      partId: z.guid(),
      outcome: z.literal("skipped"),
    }),
  ),
  transportFailure: communicationsFailure,
});

/** Requests another attempt of an unconfirmed delivery part. */
export const retryDeliveryOperation = defineMutationOperation({
  input: resolveDeliverySchema,
  method: "POST",
  path: "/api/communications/deliveries/retry",
  result: resultSchema(
    z.object({
      deliveryId: z.guid(),
      partId: z.guid(),
      outcome: z.literal("retry_requested"),
    }),
  ),
  transportFailure: communicationsFailure,
});

/** Resolves a saved post reference into its content. */
export const resolveTemplateOperation = defineMutationOperation({
  input: templateReferenceSchema,
  method: "POST",
  path: "/api/communications/templates/resolve",
  result: resultSchema(templateSchema),
  transportFailure: communicationsFailure,
});
