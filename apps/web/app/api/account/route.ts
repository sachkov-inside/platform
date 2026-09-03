import { handleAccountPresentationRequest } from "@/_pages/account.server";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handleAccountPresentationRequest();
}
