import { connection } from "next/server";

import { handleAcceptedDocumentsRequest } from "@/features/accepted-documents.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAcceptedDocumentsRequest();
}
