import { handleStartAccountEmail } from "@/features/account-email.server";
export function POST(request: Request): Promise<Response> {
  return handleStartAccountEmail(request);
}
