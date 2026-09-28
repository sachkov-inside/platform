import { connection } from "next/server";

import { handleCourseAssistantGitHubCallback } from "@/features/course-assistant-access.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleCourseAssistantGitHubCallback(request);
}
