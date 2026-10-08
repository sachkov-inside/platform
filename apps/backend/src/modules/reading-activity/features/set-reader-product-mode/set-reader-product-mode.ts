import { productModeSchema } from "@inside/material-blocks";
import type { ProductMode } from "@inside/material-blocks";
import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";

export const setReaderProductModeSchema = z
  .object({ productMode: productModeSchema })
  .strict();

const commandSchema = setReaderProductModeSchema.extend({
  accountId: z.uuid(),
});

export type SetReaderProductModeResult =
  | { readonly ok: true; readonly value: { readonly productMode: ProductMode } }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

/**
 * One stored choice per reader. The last write wins: a reader switching modes in two tabs wants
 * the switch they pressed last, and there is nothing here for a version to protect.
 */
export async function setReaderProductMode(
  prisma: ReadingActivityPrismaClient,
  command: { readonly accountId: string; readonly productMode: unknown },
): Promise<SetReaderProductModeResult> {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const accountId = parsed.data.accountId.toLowerCase();
  const now = new Date();
  try {
    await prisma.readerPreferences.upsert({
      where: { accountId },
      create: {
        accountId,
        productMode: parsed.data.productMode,
        updatedAt: now,
      },
      update: { productMode: parsed.data.productMode, updatedAt: now },
    });
    return { ok: true, value: { productMode: parsed.data.productMode } };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "setReaderProductMode" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
