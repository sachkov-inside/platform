import { handleTributeDismissImport } from "@/features/billing-admin.server";
export function POST(request: Request): Promise<Response> {
  return handleTributeDismissImport(request);
}
