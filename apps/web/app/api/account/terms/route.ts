import { handleAcceptTermsRequest } from "@/features/terms-acceptance.server";

export function POST(request: Request): Promise<Response> {
  return handleAcceptTermsRequest(request);
}
