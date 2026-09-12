import { z } from "zod";

export const globalAccessCapabilities = ["materials", "community", "reviews", "support"] as const;
export const accessCapabilitySchema = z.union([
  z.enum(globalAccessCapabilities),
  z.templateLiteral(["guide:", z.uuid()]),
]);
export type AccessCapability = z.infer<typeof accessCapabilitySchema>;
export const capabilitiesSchema = z
  .array(accessCapabilitySchema)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length)
  .overwrite((values) => values.sort());
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

/**
 * Состав решения о классификации: он одинаков для одного Account и для строки набора,
 * поэтому оба пути принимают ровно эти поля и одно и то же кросс-полевое правило.
 */
export const classificationTermsShape = {
  classification: classificationSchema,
  sourceRef: sourceRefSchema,
  reason: reasonSchema,
  bridgeEnabled: z.boolean(),
  tributeStopped: z.boolean(),
};
export type ClassificationTerms = z.infer<
  z.ZodObject<typeof classificationTermsShape>
>;
/** Переходные признаки Tribute относятся только к подтверждённому старому покупателю. */
export function classificationTermsAgree(terms: ClassificationTerms): boolean {
  return (
    terms.classification === "confirmed_legacy" ||
    (!terms.bridgeEnabled && !terms.tributeStopped)
  );
}
/**
 * Legacy gate автосписаний: «неизвестно» их запрещает, новый покупатель разрешает,
 * а старый — только после подтверждённой остановки Tribute.
 */
export function recurringAllowedFor(
  state: Pick<ClassificationTerms, "classification" | "tributeStopped">,
): boolean {
  return (
    state.classification === "confirmed_new" ||
    (state.classification === "confirmed_legacy" && state.tributeStopped)
  );
}
export const legacyClassificationViewSchema = z
  .object({
    accountId: z.uuid(),
    classification: classificationSchema,
    revision: z.number().int().nonnegative(),
    recurringAllowed: z.boolean(),
  })
  .strict();
