import {
  announcementQuerySchema,
  type AccessGrants,
  type CoverageCatalog,
} from "../../../account-rights/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

/** Published rule metadata only; this operation never grants rights or reserves an identity. */
export async function readActivationAnnouncement(
  dependencies: {
    grants: AccessGrants;
    prisma: BillingPrismaClient;
    contentCatalog?: Pick<CoverageCatalog, "resolve">;
  },
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
    const productId = rule.productId;
    if (dependencies.contentCatalog === undefined) return unavailable;
    const products = await dependencies.contentCatalog.resolve({
      productIds: [productId],
      materialIds: [],
    });
    if (
      products.length !== 1 ||
      products[0]?.id !== productId ||
      !products[0].available
    )
      return unavailable;
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
