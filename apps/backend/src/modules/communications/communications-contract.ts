import { trackingBacklogSchema } from "./facets/tracking-visits/tracking-visits.js";
import { z } from "zod";
import { requestSchema, responseSchema, errorSchema, type authorizationRequestSchema } from "./communications-schema.generated.js";

export const COMMUNICATIONS_VERSION = "inside-communications-v1" as const;
// Service-only tracking and eligibility never belong to delegated management.
export const managementSchemas = requestSchema.options.filter(
  schema => !["tracking.resolve", "tracking.recordHit", "eligibility.check"].includes(schema.shape.operation.value),
).map(schema => schema.omit({ actor: true }));
export const managementRequestSchema = z.union(managementSchemas);
export type ManagementRequest = z.infer<typeof managementRequestSchema>;
export type ProviderRequest = z.infer<typeof requestSchema>;
export type ProviderResponse = z.infer<typeof responseSchema>;
export type AuthorAuthorizationRequest = z.infer<typeof authorizationRequestSchema>;
export const communicationsFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({ code: z.enum([
    "forbidden", "invalid_input", "link_required", "authorization_unavailable",
    "provider_unavailable", "provider_invalid_response", "unauthorized", "not_found",
    "malformed", "unsupported_content", "revision_conflict", "operation_conflict", "not_implemented",
  ]) }),
});
const providerSuccessSchema = z.union(responseSchema.options.filter(
  (schema): schema is Exclude<(typeof responseSchema.options)[number], typeof errorSchema> => schema !== errorSchema,
));
export const communicationsSuccessSchema = z.strictObject({ ok: z.literal(true), value: providerSuccessSchema, trackingBacklog: trackingBacklogSchema.optional() });
export const communicationsResultSchema = z.union([
  communicationsSuccessSchema,
  communicationsFailureSchema,
]);
export type CommunicationsResult = z.infer<typeof communicationsResultSchema>;
export function communicationsFailure(code: z.infer<typeof communicationsFailureSchema>["error"]["code"]): CommunicationsResult {
  return { ok: false, error: { code } };
}
