import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  notificationPreferencesResultSchema,
  type ChangeNotificationPreferencesInput,
  type NotificationPreferencesResult,
} from "../model/notification-preferences";

function decode(body: unknown): NotificationPreferencesResult {
  const parsed = notificationPreferencesResultSchema.safeParse(body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}

/** Собственные настройки каналов: закрытый исход вместо строки в тексте ошибки. */
export async function readNotificationPreferences(): Promise<NotificationPreferencesResult> {
  let response: Response;
  try {
    response = await fetch("/api/account/notifications/preferences", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, code: "unavailable" };
  }
  if (response.status === 401) return { ok: false, code: "unauthorized" };
  try {
    return decode(await response.json());
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function changeNotificationPreferences(
  input: ChangeNotificationPreferencesInput,
): Promise<NotificationPreferencesResult> {
  const form = new FormData();
  form.set("operationId", input.operationId);
  form.set("expectedRevision", String(input.expectedRevision));
  form.set("email", String(input.email));
  form.set("telegram", String(input.telegram));
  const response = await requestSameOriginMutation(
    "/api/account/notifications/preferences/change",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      ok: false,
      code: response.status === 401 ? "unauthorized" : "unavailable",
    };
  return decode(response.body);
}
