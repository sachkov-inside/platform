import { defaultGuideMode, guideModes, isGuideMode } from "@inside/material-blocks";
import type { GuideMode } from "@inside/material-blocks";
import { z } from "zod";

import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";

/** The registry owns the mode names, so the wire contract enumerates them from it. */
export const guideModeSchema = z.enum(guideModes);

export const readerGuideModeSchema = z
  .object({ guideMode: guideModeSchema })
  .strict();

export type GetReaderGuideModeResult =
  | { readonly ok: true; readonly value: { readonly guideMode: GuideMode } }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

/**
 * The mode a reader goes through guides in. A reader who has never chosen, and a stored value the
 * registry no longer knows, both read as the default rather than as an error: the preference must
 * never be the reason a lesson fails to open.
 */
export async function getReaderGuideMode(
  prisma: ReadingActivityPrismaClient,
  query: { readonly accountId: string },
): Promise<GetReaderGuideModeResult> {
  const accountId = z.uuid().safeParse(query.accountId);
  if (!accountId.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const row = await prisma.readingPreferences.findUnique({
      where: { accountId: accountId.data.toLowerCase() },
    });
    const stored = row?.guideMode;
    return {
      ok: true,
      value: { guideMode: isGuideMode(stored) ? stored : defaultGuideMode },
    };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
