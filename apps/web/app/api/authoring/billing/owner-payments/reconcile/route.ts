import { handleReconcilePayment } from "@/features/owner-payments.server";

export function POST(request: Request): Promise<Response> {
  return handleReconcilePayment(request);
}
