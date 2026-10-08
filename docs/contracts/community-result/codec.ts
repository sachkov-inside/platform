import { z } from "zod";

const COMMUNITY_CONTRACT_VERSION = "inside.community-entitlement.v1";
const COMMUNITY_V2_CONTRACT_VERSION = "inside.community-entitlement.v2";
const id = z.uuid();
const opaqueRef = z.string().min(1).max(256);
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().positive();
const admissionRestrictionSchema: z.ZodEnum<{
 none: "none"; moderation: "moderation"; external_unknown: "external_unknown";
}> = z.enum(["none", "moderation", "external_unknown"]);

/** A member-only message link, never a join invitation or an arbitrary external URL. */
export const communityGroupUrlSchema: z.ZodURL = z.url({ protocol: /^https$/, hostname: /^t\.me$/ })
  .regex(/^https:\/\/t\.me\/c\/[1-9][0-9]*\/[1-9][0-9]*$/u);

export const communityAccessSchema: z.ZodDiscriminatedUnion<[
  z.ZodObject<{ kind: z.ZodLiteral<"denied"> }, z.core.$strict>,
  z.ZodObject<{ kind: z.ZodLiteral<"finite">; validUntil: z.ZodISODateTime }, z.core.$strict>,
  z.ZodObject<{ kind: z.ZodLiteral<"lifetime"> }, z.core.$strict>
], "kind"> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("denied") }),
  z.strictObject({ kind: z.literal("finite"), validUntil: instant }),
  z.strictObject({ kind: z.literal("lifetime") }),
]);
export type CommunityAccess = z.infer<typeof communityAccessSchema>;

export const communityBindingSchema: z.ZodObject<{
  accountRef: z.ZodString; telegramIdentityRef: z.ZodString;
  linkRef: z.ZodUUID; linkRevision: z.ZodNumber;
}, z.core.$strict> = z.strictObject({
  accountRef: opaqueRef,
  telegramIdentityRef: opaqueRef,
  linkRef: id,
  linkRevision: revision,
});
export type CommunityBinding = z.infer<typeof communityBindingSchema>;

export const communityStatusSchema: z.ZodEnum<{
  accepted: "accepted"; waiting_for_join: "waiting_for_join"; applied: "applied";
  superseded: "superseded"; failed: "failed"; unknown: "unknown"; expired: "expired";
}> = z.enum([
  "accepted",
  "waiting_for_join",
  "applied",
  "superseded",
  "failed",
  "unknown",
  "expired",
]);
export type CommunityDeliveryStatus = z.infer<typeof communityStatusSchema>;

export const observedMembershipSchema: z.ZodEnum<{
  member: "member"; not_member: "not_member"; unknown: "unknown";
}> = z.enum([
  "member",
  "not_member",
  "unknown",
]);
export type ObservedMembership = z.infer<typeof observedMembershipSchema>;

export const communityResultSchema: z.ZodObject<{
  contractVersion: z.ZodEnum<{
    "inside.community-entitlement.v1": "inside.community-entitlement.v1";
    "inside.community-entitlement.v2": "inside.community-entitlement.v2";
  }>;
  operation: z.ZodLiteral<"entitlement.result">;
  operationId: z.ZodUUID;
  binding: typeof communityBindingSchema;
  entitlementRevision: z.ZodNumber;
  access: typeof communityAccessSchema;
  status: typeof communityStatusSchema;
  observedMembership: typeof observedMembershipSchema;
  admissionRestriction: z.ZodOptional<typeof admissionRestrictionSchema>;
  groupUrl: z.ZodOptional<typeof communityGroupUrlSchema>;
  updatedAt: z.ZodISODateTime;
}, z.core.$strict> = z
  .strictObject({
    contractVersion: z.enum([
      COMMUNITY_CONTRACT_VERSION,
      COMMUNITY_V2_CONTRACT_VERSION,
    ]),
    operation: z.literal("entitlement.result"),
    operationId: id,
    binding: communityBindingSchema,
    entitlementRevision: revision,
    access: communityAccessSchema,
    status: communityStatusSchema,
    observedMembership: observedMembershipSchema,
    admissionRestriction: admissionRestrictionSchema.optional(),
    groupUrl: communityGroupUrlSchema.optional(),
    updatedAt: instant,
  })
  .refine((value) =>
    value.contractVersion === COMMUNITY_V2_CONTRACT_VERSION
      ? value.admissionRestriction !== undefined
      : value.admissionRestriction === undefined && value.groupUrl === undefined,
  )
  // `applied` claims an observation; `expired` only fits a finite right.
  .refine((value) =>
    value.status === "applied"
      ? value.access.kind === "denied"
        ? value.observedMembership === "not_member"
        : value.observedMembership === "member"
      : true,
  )
  .refine(
    (value) => value.status !== "expired" || value.access.kind === "finite",
  );
export type CommunityResult = z.infer<typeof communityResultSchema>;

