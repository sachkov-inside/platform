import { z } from "zod";
import { defineMutationOperation } from "@/shared/api/mutation-operation";
import { analyticsCaptureSchema } from "../model/analytics-contract";
/** An optional delivery report has no domain side effect and never affects the product action. */
export const captureAnalyticsOperation = defineMutationOperation({
  input: analyticsCaptureSchema,
  method: "POST",
  maxBodyBytes: 1024,
  path: "/api/analytics",
  result: z.strictObject({ accepted: z.boolean() }),
  transportFailure: () => ({ accepted: false }),
});
