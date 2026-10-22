import "server-only";
import { z } from "zod";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { requestChapterAttachments } from "@/shared/api/backend/index.server";
import type {
  chapterAttachmentsInputSchema,
  ReorderSeriesResult,
} from "../model/presentation";
import { updateChapterAttachmentsOperation } from "./series-order.operation";

const receipt = z.object({
  seriesId: z.uuid(),
  orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
});
async function execute(
  input: z.output<typeof chapterAttachmentsInputSchema>,
  token: string,
): Promise<ReorderSeriesResult> {
  try {
    const result = await requestChapterAttachments(input, token);
    if (!result.ok)
      return result.response.status === 409
        ? { kind: "conflict" }
        : result.response.status === 403
          ? { kind: "forbidden" }
          : { kind: "error", reference: "chapter-attachments-save" };
    const saved = receipt.safeParse(result.body);
    return saved.success && saved.data.seriesId === input.productId
      ? { kind: "saved", orderVersion: saved.data.orderVersion }
      : { kind: "error", reference: "chapter-attachments-receipt" };
  } catch {
    return { kind: "error", reference: "chapter-attachments-unavailable" };
  }
}
export function handleChapterAttachmentsRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, updateChapterAttachmentsOperation, {
    execute,
    invalidInput: () => ({
      kind: "error",
      reference: "chapter-attachments-input",
    }),
  });
}
