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
export function accessFailure<const Code extends string>(
  code: Code,
): { readonly ok: false; readonly error: { readonly code: Code } } {
  return { ok: false, error: { code } };
}
export type AccessFailure<Code extends string> = ReturnType<
  typeof accessFailure<Code>
>;
export function accessFailureSchema<
  const Codes extends readonly [string, ...string[]],
>(codes: Codes) {
  return z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(codes) }),
  });
}
export const grantSuccessSchema = z.object({
  ok: z.literal(true),
  grantRef: z.uuid(),
  revision: z.number().int().positive(),
});
export const grantResultSchema = z.union([
  grantSuccessSchema,
  accessFailureSchema([
    "invalid_input",
    "not_found",
    "revision_conflict",
    "operation_conflict",
    "forbidden",
  ]),
]);
export type GrantResult = z.infer<typeof grantResultSchema>;
export const classificationSchema = z.enum([
  "confirmed_legacy",
  "confirmed_new",
  "unknown",
]);
