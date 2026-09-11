import "server-only";
import { NotificationsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export type NotificationPreferencesChange = Parameters<
  NotificationsService["changeNotificationPreferences"]
>[0]["requestBody"];

export function requestNotificationPreferences(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new NotificationsService(request).readNotificationPreferences(),
    200,
    { accessToken },
  );
}

export function requestChangeNotificationPreferences(
  requestBody: NotificationPreferencesChange,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new NotificationsService(request).changeNotificationPreferences({
        requestBody,
      }),
    200,
    { accessToken },
  );
}
