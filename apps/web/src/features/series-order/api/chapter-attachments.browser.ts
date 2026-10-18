import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  reorderSeriesResultSchema,
  type ReorderSeriesResult,
} from "../model/presentation";
export async function updateChapterAttachments(input: {
  readonly productId: string;
  readonly chapterId: string;
  readonly expectedOrderVersion: string;
  readonly materialIds: readonly string[];
}): Promise<ReorderSeriesResult> {
  const form = new FormData();
  form.set("productId", input.productId);
  form.set("chapterId", input.chapterId);
  form.set("expectedOrderVersion", input.expectedOrderVersion);
  form.set("materialIds", JSON.stringify(input.materialIds));
  const result = await requestSameOriginMutation(
    "/api/authoring/products/chapter-attachments",
    "PUT",
    form,
  );
  if (!result.ok)
    return result.status === 401
      ? { kind: "unauthorized" }
      : { kind: "error", reference: "chapter-attachments-unavailable" };
  const parsed = reorderSeriesResultSchema.safeParse(result.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "chapter-attachments-response" };
}
