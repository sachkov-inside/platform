import { handleAcceptTermsRequest } from "@/features/terms-acceptance.server";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleAcceptTermsRequest(request);
}
