import { handleArchivePromotion } from "@/features/promotions.server";

export function POST(request: Request): Promise<Response> {
  return handleArchivePromotion(request);
}
