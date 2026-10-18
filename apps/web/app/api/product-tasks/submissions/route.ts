import { connection } from "next/server";
import { readTaskSubmissionsRequest } from "@/_pages/product-task.server";
import { handleSubmitProductTask } from "@/features/product-task-submission.server";

export const POST = handleSubmitProductTask;

export async function GET(request: Request): Promise<Response> {
  await connection();
  return readTaskSubmissionsRequest(request);
}
