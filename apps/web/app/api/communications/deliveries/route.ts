import { connection } from "next/server";

import { handleDeliveryList } from "@/_pages/communications.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleDeliveryList(request);
}
