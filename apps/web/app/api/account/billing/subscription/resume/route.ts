import { handleResumeRenewal } from "@/features/billing-subscription.server";
export function POST(request: Request): Promise<Response> {
  return handleResumeRenewal(request);
}
