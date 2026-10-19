import { handleWaitlistIntent } from "@/_pages/library-discovery.server";
export function POST(request: Request): Promise<Response> {
  return handleWaitlistIntent(request);
}
