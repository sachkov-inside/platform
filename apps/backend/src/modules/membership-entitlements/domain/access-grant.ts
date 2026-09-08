import { z } from "zod";

export const accessCapabilitySchema = z.enum([
  "materials",
  "community",
  "reviews",
]);
export type AccessCapability = z.infer<typeof accessCapabilitySchema>;
export const capabilitiesSchema = z
  .array(accessCapabilitySchema)
  .min(1)
  .max(3)
  .refine((values) => new Set(values).size === values.length)
  .transform((values) => values.sort());
export const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const reasonSchema = z.string().trim().min(1).max(1000);
export const sourceRefSchema = z.string().min(1).max(256);
export const grantTermsSchema = z
  .object({
    capabilities: capabilitiesSchema,
    startsAt: instantSchema,
    validUntil: instantSchema.nullable(),
    reason: reasonSchema,
  })
  .strict()
  .refine(
    (value) => value.validUntil === null || value.validUntil > value.startsAt,
  );
export type GrantTerms = z.input<typeof grantTermsSchema>;
export const accessFailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "forbidden",
      "invalid_input",
      "not_found",
      "revision_conflict",
      "operation_conflict",
      "preview_expired",
      "identity_changed",
      "unavailable",
    ]),
  }),
});
export type AccessFailure = z.infer<typeof accessFailureSchema>;
export function accessFailure(
  code: AccessFailure["error"]["code"],
): AccessFailure {
  return { ok: false, error: { code } };
}
export const grantResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    grantRef: z.uuid(),
    revision: z.number().int().positive(),
  }),
  accessFailureSchema,
]);
export type GrantResult = z.infer<typeof grantResultSchema>;
export const classificationSchema = z.enum([
  "confirmed_legacy",
  "confirmed_new",
  "unknown",
]);
