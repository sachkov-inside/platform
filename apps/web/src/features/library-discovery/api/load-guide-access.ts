import "server-only";

import { z } from "zod";

import { requestGuideAccess } from "@/shared/api/backend/index.server";

import type { GuideAccess } from "../model/library-discovery-view";

const guideAccessSchema = z.object({ access: z.enum(["open", "closed"]) });

export async function loadGuideAccess(
  guideId: string,
  accessToken: string,
): Promise<GuideAccess> {
  try {
    const result = await requestGuideAccess(guideId, accessToken);
    if (!result.ok) return "unknown";
    const parsed = guideAccessSchema.safeParse(result.body);
    return parsed.success ? parsed.data.access : "unknown";
  } catch {
    return "unknown";
  }
}
