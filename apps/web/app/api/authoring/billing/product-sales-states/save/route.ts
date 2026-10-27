import { handleSaveCohort } from "@/features/billing-admin.server";
export function POST(request: Request): Promise<Response> {
  return handleSaveCohort(request);
}
