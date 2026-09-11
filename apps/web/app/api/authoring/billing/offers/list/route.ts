import { handleListOffers } from "@/features/billing-admin.server";
export function POST(request: Request): Promise<Response> {
  return handleListOffers(request);
}
