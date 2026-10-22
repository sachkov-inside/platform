import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  notificationPreferencesResultSchema,
  type NotificationPreferencesResult,
} from "../model/notification-preferences";

import { changeNotificationPreferencesOperation } from "./notification-preferences.operation";

function decode(body: unknown): NotificationPreferencesResult {
  const parsed = notificationPreferencesResultSchema.safeParse(body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}

/** Собственные настройки каналов: закрытый исход вместо строки в тексте ошибки. */
export async function readNotificationPreferences(): Promise<NotificationPreferencesResult> {
  const result = await requestAuthenticatedRead(
    "/api/account/notifications/preferences",
  );
  if (result.kind === "rejected") {
    const parsed = notificationPreferencesResultSchema.safeParse(result.body);
    return parsed.success && !parsed.data.ok
      ? parsed.data
      : { ok: false, code: "unavailable" };
  }
  if (result.kind !== "ready")
    return {
      ok: false,
      code:
        result.kind === "authentication_required"
          ? "unauthorized"
          : "unavailable",
    };
  try {
    return decode(result.value);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export const changeNotificationPreferences =
  changeNotificationPreferencesOperation.send;
