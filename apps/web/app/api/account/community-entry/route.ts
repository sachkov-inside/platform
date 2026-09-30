import { connection } from "next/server";

import { handleCurrentCommunityEntry } from "@/features/community-entry.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleCurrentCommunityEntry();
}
