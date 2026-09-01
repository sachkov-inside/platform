import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { SeriesOrderActionState } from "../model/presentation";

const stateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), orderVersion: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ kind: z.literal("conflict") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("error"), reference: z.string() }).strict(),
]);

export async function reorderSeries(
  formData: FormData,
): Promise<SeriesOrderActionState> {
  const result = await requestSameOriginMutation(
    "/api/authoring/series/order",
    "PUT",
    formData,
  );
  if (!result.ok) {
    return result.status === 401 || result.status === 403
      ? { kind: "unauthorized" }
      : { kind: "error", reference: `series-order-bff-${String(result.status)}` };
  }
  const parsed = stateSchema.safeParse(result.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "series-order-bff-contract" };
}
