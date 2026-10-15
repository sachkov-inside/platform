import {
  productIdFromCapability,
  accessCapabilitySchema,
} from "@inside/access-capabilities";
import {
  announcementQuerySchema,
  type AccessGrants,
} from "../../../account-rights/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { tierOpenForAssignment } from "../../shared/tier-composition.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

/** Published rule metadata only; this operation never grants rights or reserves an identity. */
export async function readActivationAnnouncement(
  dependencies: { grants: AccessGrants; prisma: BillingPrismaClient },
  input: unknown,
) {
  const parsed = announcementQuerySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: { code: "invalid_input" as const } };
  const unavailable = {
    ok: false as const,
    error: { code: "policy_paused" as const },
  };
  try {
    const rule = await dependencies.grants.readAnnouncementRule(
      parsed.data.code,
    );
    if (rule === null) return unavailable;
    const offer = await dependencies.prisma.billingOffer.findUnique({
      where: { id: rule.tierId },
    });
    if (
      offer === null ||
      offer.revision !== rule.tierRevision ||
      !tierOpenForAssignment(offer)
    )
      return unavailable;
    const productIds = offer.benefits.flatMap((value) => {
      const parsed = accessCapabilitySchema.safeParse(value);
      const id = parsed.success ? productIdFromCapability(parsed.data) : null;
      return id === null ? [] : [id];
    });
    const productId = productIds[0];
    if (productIds.length !== 1 || productId === undefined) return unavailable;
    return {
      ok: true as const,
      value: {
        contractVersion: parsed.data.contractVersion,
        rule: {
          id: rule.id,
          revision: rule.revision,
          sourceRef: rule.sourceRef,
          productId,
        },
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "readActivationAnnouncement" },
      error,
      { ok: false as const, error: { code: "unavailable" as const } },
    );
  }
}
