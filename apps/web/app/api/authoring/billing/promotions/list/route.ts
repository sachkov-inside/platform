import { handleListPromotions } from "@/features/promotions.server";

export function POST(request: Request): Promise<Response> {
  return handleListPromotions(request);
}
