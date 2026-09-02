import { handleBeginTelegramLinkRequest } from "@/_pages/account.server";

export function POST(request: Request): Promise<Response> {
  return handleBeginTelegramLinkRequest(request);
}
