import { connection } from "next/server";

import { handleTrackingVisit } from "@/_pages/communication-tracking.server";

export { handleTrackingHead as HEAD } from "@/_pages/communication-tracking.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleTrackingVisit(request);
}
