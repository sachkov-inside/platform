import { handleListCourseActivationRules } from "@/features/course-activation-rules.server";
export function POST(request: Request): Promise<Response> {
  return handleListCourseActivationRules(request);
}
