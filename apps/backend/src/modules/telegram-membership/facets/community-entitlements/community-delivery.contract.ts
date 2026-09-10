import { z } from "zod";

import {
  communityAccessSchema,
  communityStatusSchema,
  observedMembershipSchema,
} from "../../domain/community-entitlement.js";

const instant = z.iso.datetime({ offset: true });

/**
 * The operator view of one Account's community delivery. Desired, accepted and applied
 * are deliberately separate fields: a queue acknowledgement is not membership.
 */
export const communityDeliveryViewSchema = z.strictObject({
  desired: z
    .strictObject({
      entitlementRevision: z.number().int().nonnegative(),
      access: communityAccessSchema,
      telegramIdentityRef: z.string().nullable(),
      nextBoundary: instant.nullable(),
      projectedAt: instant,
    })
    .nullable(),
  operations: z.array(
    z.strictObject({
      operationId: z.uuid(),
      entitlementRevision: z.number().int().positive(),
      purpose: z.enum(["apply", "cleanup"]),
      access: communityAccessSchema,
      delivery: z.enum(["pending", "accepted", "rejected", "superseded"]),
      appliedState: communityStatusSchema.nullable(),
      observedMembership: observedMembershipSchema.nullable(),
      errorCode: z.string().nullable(),
      issuedAt: instant,
      updatedAt: instant,
    }),
  ),
});

export type CommunityDeliveryView = z.infer<typeof communityDeliveryViewSchema>;
