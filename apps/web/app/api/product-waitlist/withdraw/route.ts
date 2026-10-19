import { handleWaitlistWithdraw } from "@/_pages/library-discovery.server";
export function POST(request: Request): Promise<Response> {
  return handleWaitlistWithdraw(request);
}
