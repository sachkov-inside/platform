import { handleWaitlistJoin } from "@/_pages/library-discovery.server";
export function POST(request: Request): Promise<Response> {
  return handleWaitlistJoin(request);
}
