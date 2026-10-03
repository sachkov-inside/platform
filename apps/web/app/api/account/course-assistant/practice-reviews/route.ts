import { handleRequestPracticeReview } from "@/features/practice-review.server";

export function POST(request: Request): Promise<Response> {
  return handleRequestPracticeReview(request);
}
