import type { z } from "zod";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { broadcastResultSchema, broadcastListSchema, funnelListSchema, statisticsResultSchema, deliveryListSchema, entryListSchema, templateResultSchema, type BroadcastActionInput, type SaveBroadcastInput } from "../model/communications";
function form(input: object) { const value = new FormData(); value.set("input", JSON.stringify(input)); return value; }
async function read<T>(url: string, schema: z.ZodType<T>): Promise<T | { kind: "error"; code: string }> {
  try { const response = await fetch(url, { cache: "no-store" }); const body: unknown = await response.json(); const parsed = schema.safeParse(body); return response.ok && parsed.success ? parsed.data : { kind: "error", code: "invalid_response" }; }
  catch { return { kind: "error", code: "provider_unavailable" }; }
}
function query(input: Record<string, string | undefined>) { return new URLSearchParams(Object.entries(input).filter((pair): pair is [string, string] => pair[1] !== undefined)).toString(); }
export const readBroadcasts = (cursor?: string) => read(`/api/communications/broadcasts?${query({ cursor })}`, broadcastListSchema);
export const readBroadcast = (broadcastId: string) => read(`/api/communications/broadcast?${query({ broadcastId })}`, broadcastResultSchema);
export const readFunnels = (cursor?: string) => read(`/api/communications/funnels?${query({ cursor })}`, funnelListSchema);
export const readStatistics = (scope: { broadcastId?: string; funnelId?: string; cursor?: string }) => read(`/api/communications/statistics?${query(scope)}`, statisticsResultSchema);
export const readDeliveries = (scope: { broadcastId?: string; funnelId?: string; cursor?: string }) => read(`/api/communications/deliveries?${query(scope)}`, deliveryListSchema);
export const readEntries = (contactId: string, cursor?: string) => read(`/api/communications/entries?${query({ contactId, cursor })}`, entryListSchema);
function result<T>(response: Awaited<ReturnType<typeof requestSameOriginMutation>>, schema: z.ZodType<T>): T | { kind: "error"; code: string } {
  if (!response.ok) return { kind: "error", code: response.status === 401 || response.status === 403 ? "authentication_required" : "provider_unavailable" };
  const parsed = schema.safeParse(response.body); return parsed.success ? parsed.data : { kind: "error", code: "invalid_response" };
}
export async function saveBroadcast(input: SaveBroadcastInput) {
  return result(await requestSameOriginMutation("/api/communications/broadcasts/save", "POST", form(input)), broadcastResultSchema);
}
export async function launchBroadcast(input: BroadcastActionInput) {
  return result(await requestSameOriginMutation("/api/communications/broadcasts/launch", "POST", form(input)), broadcastResultSchema);
}
export async function pauseBroadcast(input: BroadcastActionInput) {
  return result(await requestSameOriginMutation("/api/communications/broadcasts/pause", "POST", form(input)), broadcastResultSchema);
}
export async function resumeBroadcast(input: BroadcastActionInput) {
  return result(await requestSameOriginMutation("/api/communications/broadcasts/resume", "POST", form(input)), broadcastResultSchema);
}
export async function cancelBroadcast(input: BroadcastActionInput) {
  return result(await requestSameOriginMutation("/api/communications/broadcasts/cancel", "POST", form(input)), broadcastResultSchema);
}
export async function resolveTemplate(input: { reference: string; operationId: string }) {
  return result(await requestSameOriginMutation("/api/communications/templates/resolve", "POST", form(input)), templateResultSchema);
}
