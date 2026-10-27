import { connection } from "next/server";
import {
  handleAnalyticsConfig,
  handleAnalyticsCapture,
} from "@/features/storage-notice.server";
export async function GET(): Promise<Response> {
  await connection();
  return handleAnalyticsConfig();
}
export { handleAnalyticsCapture as POST };
