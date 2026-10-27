import "server-only";

import { z } from "zod";

import type { ProductOrderPresentation } from "../model/presentation";
import {
  BackendConnectionError,
  requestProductOrder,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const schema = z
  .object({
    archived: z.boolean(),
    programmePlacements: z
      .array(
        z.object({
          id: z.uuid(),
          materialId: z.uuid(),
          chapterId: z.uuid().nullable(),
          stepGroup: z.string().nullable(),
        }),
      )
      .optional(),
    chapters: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().min(1),
            ordinal: z.number().int().positive(),
            summary: z.string(),
            supplementaryMaterialIds: z.array(z.uuid()).optional(),
          })
          .strict(),
      )
      .default([]),
    items: z.array(
      z
        .object({
          chapterId: z.uuid().nullable().optional(),
          materialId: z.uuid(),
          ordinal: z.number().int().positive(),
          stepGroup: z.string().nullable().optional(),
          publicationState: z.enum(["draft", "published", "unpublished"]),
          title: z.string().nullable(),
        })
        .strict(),
    ),
    name: z.string().min(1),
    orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    productId: z.uuid(),
  })
  .strict();

export type ProductOrderState =
  | {
      readonly kind: "ready";
      readonly order: Omit<ProductOrderPresentation, "options">;
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly reference: string };

export async function getProductOrder(
  productId: string,
  accessToken: string,
  request: typeof requestProductOrder = requestProductOrder,
): Promise<ProductOrderState> {
  if (!z.uuid().safeParse(productId).success) return { kind: "not_found" };
  let result: BackendTransportResult;
  try {
    result = await request(productId, accessToken);
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
    return { kind: "error", reference: "product-order-response" };
  }
  const parsed = schema.safeParse(result.body);
  if (!parsed.success || parsed.data.productId !== productId) {
    return { kind: "error", reference: "product-order-shape" };
  }
  return {
    kind: "ready",
    order: {
      archived: parsed.data.archived,
      ...(parsed.data.programmePlacements === undefined
        ? {}
        : { programmePlacements: parsed.data.programmePlacements }),
      chapters: parsed.data.chapters.map(
        ({ id, name, summary, supplementaryMaterialIds }) => ({
          ...(supplementaryMaterialIds === undefined
            ? {}
            : { supplementaryMaterialIds }),
          id,
          name,
          summary,
        }),
      ),
      items: parsed.data.items.map((item) => ({
        chapterId: item.chapterId ?? null,
        materialId: item.materialId,
        ...(item.stepGroup === undefined ? {} : { stepGroup: item.stepGroup }),
        publicationState: item.publicationState,
        title: item.title ?? "Без названия",
      })),
      name: parsed.data.name,
      orderVersion: parsed.data.orderVersion,
      productId: parsed.data.productId,
    },
  };
}
