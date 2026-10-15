import { connection } from "next/server";
import { handleTelegramContinuationRead } from "@/_pages/telegram-continuation.server";
export async function GET(
  _request: Request,
  context: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  await connection();
  return handleTelegramContinuationRead((await context.params).attemptId);
}
