import "server-only";
import { z } from "zod";
import { requestSeriesContinuation } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { continuationLabel, seriesContinuationProjectionSchema, type SeriesContinuationView } from "../model/series-continuation-contract";
export async function getSeriesContinuation(slug: string, token: string): Promise<SeriesContinuationView> {
  try {
    const response = await requestSeriesContinuation(slug, token);
    if (!response.ok) return { kind: response.response.status === 401 ? "hidden" : "unavailable" };
    const parsed = seriesContinuationProjectionSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.collection.slug !== slug) return { kind: "unavailable" };
    const { read, total, continuation } = parsed.data;
    return { kind: "ready", read, total, continuation: continuation === null ? null : { materialSlug: continuation.materialSlug, label: continuationLabel(continuation.resume) } };
  } catch { return { kind: "unavailable" }; }
}
export function handleSeriesContinuation(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const slug = z.string().min(1).max(120).safeParse(form.get("slug"));
    return slug.success ? getSeriesContinuation(slug.data, token) : { kind: "invalid_input" };
  });
}
