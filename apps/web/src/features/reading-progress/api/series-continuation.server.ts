import "server-only";
import { requestSeriesContinuation } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  continuationLabel,
  seriesContinuationProjectionSchema,
  type SeriesContinuationView,
} from "../model/series-continuation-contract";
import { loadSeriesContinuationOperation } from "./reading-progress.operation";
export async function getSeriesContinuation(
  slug: string,
  token: string,
): Promise<SeriesContinuationView> {
  try {
    const response = await requestSeriesContinuation(slug, token);
    if (!response.ok)
      return {
        kind: response.response.status === 401 ? "hidden" : "unavailable",
      };
    const parsed = seriesContinuationProjectionSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.collection.slug !== slug)
      return { kind: "unavailable" };
    const { read, total, continuation, started } = parsed.data;
    return {
      kind: "ready",
      ...(started === undefined ? {} : { started }),
      read,
      total,
      continuation:
        continuation === null
          ? null
          : {
              materialSlug: continuation.materialSlug,
              label: continuationLabel(continuation.resume),
            },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
export function handleSeriesContinuation(request: Request) {
  return handleMutationOperation(request, loadSeriesContinuationOperation, {
    // A slug outside the schema reads as unavailable, as the browser saw it before.
    invalidInput: () => ({ kind: "unavailable" }) as const,
    execute: (input, token) => getSeriesContinuation(input.slug, token),
  });
}
