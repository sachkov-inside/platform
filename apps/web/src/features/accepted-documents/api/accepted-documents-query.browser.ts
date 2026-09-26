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
    const response = await fetch("/api/account/legal-acceptances", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = z
      .object({ documents: z.array(acceptedDocumentSchema) })
      .safeParse(await response.json());
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
