import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  changeNotificationPreferencesInputSchema,
  notificationPreferencesResultSchema,
} from "../model/notification-preferences";

/** Changes which channels deliver the Account's notifications, at the revision it saw. */
export const changeNotificationPreferencesOperation = defineMutationOperation({
  input: z.object(changeNotificationPreferencesInputSchema.shape),
  method: "POST",
  path: "/api/account/notifications/preferences/change",
  result: notificationPreferencesResultSchema,
  transportFailure: (failure) =>
    ({
      ok: false,
      code:
        failure.kind === "status" && failure.status === 401
          ? "unauthorized"
          : "unavailable",
    }) as const,
});
