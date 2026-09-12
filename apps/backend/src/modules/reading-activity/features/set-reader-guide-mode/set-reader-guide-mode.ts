import type { GuideMode } from "@inside/material-blocks";
import { z } from "zod";

import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { guideModeSchema } from "../get-reader-guide-mode/get-reader-guide-mode.js";

export const setReaderGuideModeSchema = z
  .object({ guideMode: guideModeSchema })
  .strict();

const commandSchema = setReaderGuideModeSchema.extend({ accountId: z.uuid() });

export type SetReaderGuideModeResult =
  | { readonly ok: true; readonly value: { readonly guideMode: GuideMode } }
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
export async function setReaderGuideMode(
  prisma: ReadingActivityPrismaClient,
  command: { readonly accountId: string; readonly guideMode: unknown },
): Promise<SetReaderGuideModeResult> {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const accountId = parsed.data.accountId.toLowerCase();
  const now = new Date();
  try {
    await prisma.readerPreferences.upsert({
      where: { accountId },
      create: { accountId, guideMode: parsed.data.guideMode, updatedAt: now },
      update: { guideMode: parsed.data.guideMode, updatedAt: now },
    });
    return { ok: true, value: { guideMode: parsed.data.guideMode } };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
