import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { seriesContinuationResultSchema, type SeriesContinuationView } from "../model/series-continuation-contract";
export async function loadSeriesContinuation(slug: string): Promise<SeriesContinuationView> {
  const form = new FormData(); form.set("slug", slug);
  const response = await requestSameOriginMutation("/api/reading-progress/guide-continuation", "POST", form);
  if (!response.ok) return { kind: response.status === 401 ? "hidden" : "unavailable" };
  const parsed = seriesContinuationResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
