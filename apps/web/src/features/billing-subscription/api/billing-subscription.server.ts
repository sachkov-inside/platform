import "server-only";
import { z } from "zod";
import {
  requestCurrentCommunityAdmission,
  requestCurrentBilling,
} from "@/shared/api/backend/index.server";

import { currentBillingSchema } from "@/entities/subscription";
import { readAuthenticatedBilling } from "@/entities/subscription.server";

export function handleCurrentBilling(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentBilling(accessToken),
    currentBillingSchema,
  );
}

export function handleCurrentCommunityAdmission(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentCommunityAdmission(accessToken),
    z.strictObject({
      admissionRestriction: z
        .enum(["none", "moderation", "external_unknown"])
        .nullable(),
      state: z.enum(["checking", "no_access", "moderation_blocked", "ready"]),
    }),
  );
}
