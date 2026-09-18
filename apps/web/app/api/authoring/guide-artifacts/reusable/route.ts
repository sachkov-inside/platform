import { connection } from "next/server";

import { handleReadReusableGuideArtifactsRequest } from "@/features/guide-artifacts.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleReadReusableGuideArtifactsRequest();
}
