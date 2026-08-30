import "server-only";

import { z } from "zod";

import type { SeriesOrderPresentation } from "@/features/series-order";
import {
  BackendConnectionError,
  requestSeriesOrder,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const schema = z
  .object({
    items: z.array(
      z
        .object({
          materialId: z.uuid(),
          ordinal: z.number().int().positive(),
          publicationState: z.enum(["draft", "published", "unpublished"]),
          title: z.string().nullable(),
        })
        .strict(),
    ),
    name: z.string().min(1),
    orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    seriesId: z.uuid(),
  })
  .strict();

export type SeriesOrderState =
  | { readonly kind: "ready"; readonly order: Omit<SeriesOrderPresentation, "options"> }
  | { readonly kind: "not_found" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly reference: string };

export async function getSeriesOrder(
  seriesId: string,
  accessToken: string,
  request: typeof requestSeriesOrder = requestSeriesOrder,
): Promise<SeriesOrderState> {
  if (!z.uuid().safeParse(seriesId).success) return { kind: "not_found" };
  let result: BackendTransportResult;
  try {
    result = await request(seriesId, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError) {
      return { kind: "error", reference: error.code };
    }
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.response.status === 404) return { kind: "not_found" };
    return { kind: "error", reference: "series-order-response" };
  }
  const parsed = schema.safeParse(result.body);
  if (!parsed.success || parsed.data.seriesId !== seriesId) {
    return { kind: "error", reference: "series-order-shape" };
  }
  return {
    kind: "ready",
    order: {
      items: parsed.data.items.map((item) => ({
        materialId: item.materialId,
        publicationState: item.publicationState,
        title: item.title ?? "Без названия",
      })),
      name: parsed.data.name,
      orderVersion: parsed.data.orderVersion,
      seriesId: parsed.data.seriesId,
    },
  };
}
