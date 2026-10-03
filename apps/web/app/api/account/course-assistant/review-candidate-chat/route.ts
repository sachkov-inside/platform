import { handleReviewCandidateChat } from "@/features/practice-review.server";

export function POST(request: Request): Promise<Response> {
  return handleReviewCandidateChat(request);
}
