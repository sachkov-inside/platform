import { handleBeginCourseAssistantRepositoryConnection } from "@/features/course-assistant-access.server";

export function POST(request: Request): Promise<Response> {
  return handleBeginCourseAssistantRepositoryConnection(request);
}
