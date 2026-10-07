import {
  defaultProductMode,
  productModeSchema,
  isProductMode,
} from "@inside/material-blocks";
import type { ProductMode } from "@inside/material-blocks";
import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";

export const readerProductModeSchema = z
  .object({ productMode: productModeSchema })
  .strict();

export type GetReaderProductModeResult =
  | { readonly ok: true; readonly value: { readonly productMode: ProductMode } }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

/**
 * The mode a reader goes through products in. A reader who has never chosen, and a stored value the
 * registry no longer knows, both read as the default rather than as an error: the preference must
 * never be the reason a lesson fails to open.
 */
export async function getReaderProductMode(
  prisma: ReadingActivityPrismaClient,
  query: { readonly accountId: string },
): Promise<GetReaderProductModeResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  if (!accountId.success)
    return { ok: false, error: { code: "invalid_request" } };
  try {
    const row = await prisma.readerPreferences.findUnique({
      where: { accountId: accountId.data.toLowerCase() },
    });
    const stored = row?.productMode;
    return {
      ok: true,
      value: {
        productMode: isProductMode(stored) ? stored : defaultProductMode,
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "getReaderProductMode" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
