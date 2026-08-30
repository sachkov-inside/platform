"use server";

import { z } from "zod";

import type { ProfileReportState } from "@/_pages/account";
import { requestMemberProfileReport } from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { parseReportOutcome } from "./member-profile-contract";

const reportSchema = z.object({
  publicProfileId: z.uuid(),
  reason: z.enum(["unsafe_content", "impersonation", "other"]),
});

export async function reportMemberProfileAction(
  _previousState: ProfileReportState,
  formData: FormData,
): Promise<ProfileReportState> {
  const parsed = reportSchema.safeParse({
    publicProfileId: formData.get("publicProfileId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { kind: "unavailable" };

  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return { kind: "unavailable" };
    }
    throw error;
  }
  try {
    const result = await requestMemberProfileReport(
      parsed.data.publicProfileId,
      parsed.data.reason,
      accessToken,
    );
    if (!result.ok) return { kind: "unavailable" };
    const outcome = parseReportOutcome(result.body);
    return { duplicate: outcome === "already_recorded", kind: "reported" };
  } catch {
    return { kind: "unavailable" };
  }
}
