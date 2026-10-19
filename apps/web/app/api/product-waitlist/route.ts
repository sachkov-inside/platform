import { handleWaitlistRead } from "@/_pages/library-discovery.server";
import { connection } from "next/server";
export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleWaitlistRead(request);
}
