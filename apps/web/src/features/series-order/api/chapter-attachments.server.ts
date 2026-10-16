import "server-only";
import { z } from "zod";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { requestChapterAttachments } from "@/shared/api/backend/index.server";
import type { ReorderSeriesResult } from "../model/presentation";

const schema = z.object({
  productId: z.uuid(),
  chapterId: z.uuid(),
  expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  materialIds: z.array(z.uuid()).max(200),
});
const receipt = z.object({
  seriesId: z.uuid(),
  orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
});
async function execute(
  form: FormData,
  token: string,
): Promise<ReorderSeriesResult> {
  const rawIds = form.get("materialIds");
  if (typeof rawIds !== "string")
    return { kind: "error", reference: "chapter-attachments-input" };
  let ids: unknown;
  try {
    ids = JSON.parse(rawIds) as unknown;
  } catch {
    return { kind: "error", reference: "chapter-attachments-input" };
  }
  const parsed = schema.safeParse({
    productId: form.get("productId"),
    chapterId: form.get("chapterId"),
    expectedOrderVersion: form.get("expectedOrderVersion"),
    materialIds: ids,
  });
  if (!parsed.success)
    return { kind: "error", reference: "chapter-attachments-input" };
  try {
    const result = await requestChapterAttachments(parsed.data, token);
    if (!result.ok)
      return result.response.status === 409
        ? { kind: "conflict" }
        : result.response.status === 403
          ? { kind: "forbidden" }
          : { kind: "error", reference: "chapter-attachments-save" };
    const saved = receipt.safeParse(result.body);
    return saved.success && saved.data.seriesId === parsed.data.productId
      ? { kind: "saved", orderVersion: saved.data.orderVersion }
      : { kind: "error", reference: "chapter-attachments-receipt" };
  } catch {
    return { kind: "error", reference: "chapter-attachments-unavailable" };
  }
}
export function handleChapterAttachmentsRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, execute);
}
