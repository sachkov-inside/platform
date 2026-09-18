import { connection } from "next/server";

import { handleReadNotificationPreferences } from "@/features/notification-preferences.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleReadNotificationPreferences();
}
