import { handleConfirmTelegramLinkRequest } from "@/_pages/account.server";

export function POST(request: Request): Promise<Response> {
  return handleConfirmTelegramLinkRequest(request);
}
