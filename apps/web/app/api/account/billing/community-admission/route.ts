import { handleCurrentCommunityAdmission } from "@/features/billing-subscription.server";
export function GET(): Promise<Response> { return handleCurrentCommunityAdmission(); }
