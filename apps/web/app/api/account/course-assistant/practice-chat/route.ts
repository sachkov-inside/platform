import { connection } from "next/server";

import {
  handlePracticeReviewChat,
  handlePracticeReviewResume,
} from "@/features/practice-review.server";

export function POST(request: Request): Promise<Response> {
  return handlePracticeReviewChat(request);
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handlePracticeReviewResume(request);
}
