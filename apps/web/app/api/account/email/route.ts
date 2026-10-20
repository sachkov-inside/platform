import { connection } from "next/server";
import { handleReadAccountEmail } from "@/features/account-email.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleReadAccountEmail();
}
