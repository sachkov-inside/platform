import { handleRevokeProductAccess } from "@/entities/subscription.server";
export function POST(request: Request): Promise<Response> {
  return handleRevokeProductAccess(request);
}
