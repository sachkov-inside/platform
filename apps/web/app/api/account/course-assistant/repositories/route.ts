import { connection } from "next/server";

import { handleReadCourseAssistantRepositories } from "@/features/course-assistant-access.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleReadCourseAssistantRepositories();
}
