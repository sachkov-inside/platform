import { handleArchivePromotion } from "@/features/billing-admin.server";
export function POST(request: Request): Promise<Response> {
  return handleArchivePromotion(request);
}
