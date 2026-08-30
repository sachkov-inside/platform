import { handleProfileExportRequest } from "@/_pages/account.server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleProfileExportRequest();
}
