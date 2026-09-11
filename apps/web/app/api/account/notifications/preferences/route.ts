import { handleReadNotificationPreferences } from "@/features/notification-preferences.server";

export function GET(): Promise<Response> {
  return handleReadNotificationPreferences();
}
