import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import {
  acceptedDocumentSchema,
  type AcceptedDocument,
} from "../model/accepted-documents";

export const acceptedDocumentsQueryKey = [
  "account",
  "legal-acceptances",
] as const;

export type AcceptedDocumentsResult =
  | Readonly<{ kind: "ready"; documents: readonly AcceptedDocument[] }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{ kind: "unavailable" }>;

async function requestAcceptedDocuments(
  signal: AbortSignal,
): Promise<AcceptedDocumentsResult> {
  try {
    const result = await requestAuthenticatedRead(
      "/api/account/legal-acceptances",
      signal,
    );
    if (result.kind === "authentication_required")
      return { kind: "unauthorized" };
    if (result.kind !== "ready") return { kind: "unavailable" };
    const parsed = z
      .object({ documents: z.array(acceptedDocumentSchema) })
      .safeParse(result.value);
    return parsed.success
      ? { kind: "ready", documents: parsed.data.documents }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export function acceptedDocumentsQueryOptions() {
  return queryOptions({
    queryKey: acceptedDocumentsQueryKey,
    queryFn: ({ signal }) => requestAcceptedDocuments(signal),
  });
}
