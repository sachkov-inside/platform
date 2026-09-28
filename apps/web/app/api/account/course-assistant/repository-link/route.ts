import {
  handleDisconnectCourseAssistantRepository,
  handleLinkCourseAssistantRepository,
} from "@/features/course-assistant-access.server";

export function PUT(request: Request): Promise<Response> {
  return handleLinkCourseAssistantRepository(request);
}

export function DELETE(request: Request): Promise<Response> {
  return handleDisconnectCourseAssistantRepository(request);
}
