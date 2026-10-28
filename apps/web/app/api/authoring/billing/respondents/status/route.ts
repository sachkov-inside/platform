import { handleQuestionnaireRespondents } from "@/features/promotions.server";

export function POST(request: Request): Promise<Response> {
  return handleQuestionnaireRespondents(request);
}
