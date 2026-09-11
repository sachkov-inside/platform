import { handleChangeNotificationPreferences } from "@/features/notification-preferences.server";

export function POST(request: Request): Promise<Response> {
  return handleChangeNotificationPreferences(request);
}
