import { handleAcceptedDocumentsRequest } from "@/features/accepted-documents.server";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handleAcceptedDocumentsRequest();
}
