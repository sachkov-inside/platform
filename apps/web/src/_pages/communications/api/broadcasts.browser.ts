import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import type { z } from "zod";
import {
  errorSchema,
  savedPostListSchema,
  broadcastResultSchema,
  broadcastListSchema,
  funnelListSchema,
  statisticsResultSchema,
  deliveryListSchema,
  entryListSchema,
} from "../model/broadcasts";
import {
  cancelBroadcastOperation,
  launchBroadcastOperation,
  pauseBroadcastOperation,
  resolveBroadcastTemplateOperation,
  resumeBroadcastOperation,
  samplePostOperation,
  saveBroadcastOperation,
  savePostOperation,
} from "./broadcasts.operation";
async function read<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<T | { kind: "error"; code: string }> {
  try {
    const result = await requestAuthenticatedRead(url);
    if (result.kind === "rejected") {
      const failure = errorSchema.safeParse(result.body);
      return failure.success
        ? failure.data
        : { kind: "error", code: "provider_unavailable" };
    }
    if (result.kind !== "ready")
      return {
        kind: "error",
        code:
          result.kind === "authentication_required"
            ? "authentication_required"
            : result.kind === "identity_unavailable"
              ? "identity_unavailable"
              : "provider_unavailable",
      };
    const parsed = schema.safeParse(result.value);
    return parsed.success
      ? parsed.data
      : { kind: "error", code: "invalid_response" };
  } catch {
    return { kind: "error", code: "provider_unavailable" };
  }
}
function query(input: Record<string, string | undefined>) {
  return new URLSearchParams(
    Object.entries(input).filter(
      (pair): pair is [string, string] => pair[1] !== undefined,
    ),
  ).toString();
}
export const readBroadcasts = (cursor?: string) =>
  read(
    `/api/communications/broadcasts?${query({ cursor })}`,
    broadcastListSchema,
  );
export const readBroadcast = (broadcastId: string) =>
  read(
    `/api/communications/broadcast?${query({ broadcastId })}`,
    broadcastResultSchema,
  );
export const readFunnels = (cursor?: string) =>
  read(`/api/communications/funnels?${query({ cursor })}`, funnelListSchema);
export const readStatistics = (scope: {
  broadcastId?: string;
  funnelId?: string;
  cursor?: string;
}) =>
  read(
    `/api/communications/statistics?${query(scope)}`,
    statisticsResultSchema,
  );
export const readDeliveries = (scope: {
  broadcastId?: string;
  funnelId?: string;
  cursor?: string;
}) =>
  read(`/api/communications/deliveries?${query(scope)}`, deliveryListSchema);
export const readEntries = (contactId: string, cursor?: string) =>
  read(
    `/api/communications/entries?${query({ contactId, cursor })}`,
    entryListSchema,
  );
export const saveBroadcast = saveBroadcastOperation.send;
export const launchBroadcast = launchBroadcastOperation.send;
export const pauseBroadcast = pauseBroadcastOperation.send;
export const resumeBroadcast = resumeBroadcastOperation.send;
export const cancelBroadcast = cancelBroadcastOperation.send;
export const resolveTemplate = resolveBroadcastTemplateOperation.send;

export const readSavedPosts = (cursor?: string) =>
  read(
    `/api/communications/templates?${query({ cursor })}`,
    savedPostListSchema,
  );
export const savePost = savePostOperation.send;
export const samplePost = samplePostOperation.send;
