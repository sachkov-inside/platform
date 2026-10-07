import { z } from "zod";
import {
  accessCapabilitySchema,
  productIdFromCapability,
  coverageEntrySchema,
  globalAccessCapabilities,
} from "@inside/access-capabilities";
import {
  activationOutcomeSchema,
  enrollmentViewSchema,
  ownAccessGroundSchema,
  tierSnapshotSchema,
} from "../../account-rights/index.js";

/** Transitional representation for the already deployed bot. Remove after its contract upgrade. */
export const BOT_DOMAIN_NAMES_HEADER = "x-inside-domain-names";
export const BOT_DOMAIN_NAMES_VERSION = "products.v1";
const previousCapabilitySchema = z.union([
  z.enum(globalAccessCapabilities),
  z.templateLiteral(["guide:", z.uuid()]),
]);
const previousTierSchema = z.strictObject({
  id: tierSnapshotSchema.shape.id,
  revision: tierSnapshotSchema.shape.revision,
  name: tierSnapshotSchema.shape.name,
  benefits: z.array(previousCapabilitySchema),
  benefitPeriods: z
    .array(
      z.strictObject({
        capability: previousCapabilitySchema,
        months: z.int().positive().max(1200).nullable(),
      }),
    )
    .max(100)
    .optional(),
  contentScope: z.strictObject({
    guideIds: z.array(z.uuid()),
    materialIds: z.array(z.uuid()),
    allGuides: z.literal(true).optional(),
  }),
});
const previousEnrollmentSchema = enrollmentViewSchema.extend({
  tier: previousTierSchema,
  content: z
    .array(coverageEntrySchema.extend({ kind: z.enum(["guide", "material"]) }))
    .optional(),
});
export const botEnrollmentSchema = z.union([
  enrollmentViewSchema,
  previousEnrollmentSchema,
]);
export const botActivationOutcomeSchema = z.union([
  activationOutcomeSchema,
  activationOutcomeSchema.extend({
    enrollment: previousEnrollmentSchema.nullable(),
  }),
]);
export const botOwnAccessGroundSchema = z.union([
  ownAccessGroundSchema,
  ownAccessGroundSchema.extend({
    capabilities: z.array(previousCapabilitySchema),
  }),
]);

/** Canonical responses need an explicit opt-in until Platform and Telegram have both shipped. */
export function botDomainResponse(
  value: unknown,
  domainNames: string | undefined,
): unknown {
  if (domainNames === BOT_DOMAIN_NAMES_VERSION) return value;
  return previousNames(value);
}

function previousNames(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((child: unknown) => previousNames(child));
  if (typeof value === "string") {
    const parsed = accessCapabilitySchema.safeParse(value);
    const productId = parsed.success
      ? productIdFromCapability(parsed.data)
      : null;
    return productId === null ? value : `guide:${productId}`;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]: [string, unknown]) => [
      key === "coverage"
        ? "contentScope"
        : key === "wholePlatform"
          ? "allGuides"
          : key.replaceAll("product", "guide"),
      key === "kind" && child === "product" ? "guide" : previousNames(child),
    ]),
  );
}
