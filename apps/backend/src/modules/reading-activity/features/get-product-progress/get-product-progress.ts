import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { z } from "zod";
import { readProgrammeMaterials } from "../../shared/product-progress.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  PublishedProductComposition,
  PublishedProductCompositionResult,
} from "../../../products/index.js";

const querySchema = z
  .object({ accountId: z.uuid(), productId: z.uuid() })
  .strict();
export const productProgressSchema = z
  .object({
    productId: z.uuid(),
    read: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    allRead: z.boolean(),
  })
  .strict();
export type GetProductProgressResult =
  | { readonly ok: true; readonly value: z.infer<typeof productProgressSchema> }
  | Extract<PublishedProductCompositionResult, { readonly ok: false }>;

export async function getProductProgress(
  dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly contentAccess: Pick<ContentAccess, "checkProductAccess">;
    readonly composition: Pick<PublishedProductComposition, "read">;
  },
  input: { readonly accountId: string; readonly productId: string },
): Promise<GetProductProgressResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const composition = await dependencies.composition.read(
      parsed.data.productId,
      {
        subject: {
          kind: "account",
          accountId: accountId(parsed.data.accountId),
        },
        contentAccess: dependencies.contentAccess,
      },
    );
    if (!composition.ok) return composition;
    const total = composition.value.length;
    const read = await dependencies.prisma.readingMaterialState.count({
      where: {
        accountId: parsed.data.accountId,
        ...readProgrammeMaterials(composition.value),
      },
    });
    return {
      ok: true,
      value: {
        productId: parsed.data.productId.toLowerCase(),
        total,
        read,
        allRead: total > 0 && total === read,
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "getProductProgress" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
