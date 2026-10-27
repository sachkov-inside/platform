import { connection } from "next/server";

import { handleAwaitingFeedbackCountRequest } from "@/features/submission-feedback-queue.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAwaitingFeedbackCountRequest();
}
