import { handleReconcilePayment } from "@/features/billing-admin.server";
export function POST(request: Request): Promise<Response> {
  return handleReconcilePayment(request);
}
