import { handleAcknowledgeCourseAssistantDataNotice } from "@/features/course-assistant-access.server";

export function POST(request: Request): Promise<Response> {
  return handleAcknowledgeCourseAssistantDataNotice(request);
}
