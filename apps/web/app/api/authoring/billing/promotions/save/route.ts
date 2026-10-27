import { handleSavePromotion } from "@/features/promotions.server";

export function POST(request: Request): Promise<Response> {
  return handleSavePromotion(request);
}
