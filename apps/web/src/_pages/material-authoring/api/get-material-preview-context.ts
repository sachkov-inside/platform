import "server-only";

import type { Route } from "next";
import { z } from "zod";

import { authoringVideoSchema } from "@/features/material-video/model/video";
import { getSeriesOrder } from "@/features/series-order.server";
import {
  BackendConnectionError,
  requestCurrentMaterial,
  requestSeriesOrder,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { authoringMaterialPreviewHref } from "@/shared/routing/authoring";
import type {
  MaterialPreviewRoutePresentation,
  MaterialPreviewVideo,
} from "@/widgets/material-authoring/model";

import { buildMaterialPreviewRoute } from "../model/preview-route";

/** Из редакторского чтения предпросмотру нужно только основное видео. */
const currentVideoSchema = z
  .object({ primaryVideo: authoringVideoSchema.nullable() })
  .loose();

/**
 * Маршрут — дополнение к материалу: его сбой не прячет сам предпросмотр, а называется на месте
 * навигации. Отказ в правах прятать нельзя: он относится ко всей странице.
 */
export async function getMaterialPreviewRoute(
  input: {
    readonly accessToken: string;
    /** Руководство, выбранное в адресе; чужое или неизвестное заменяется первым руководством. */
    readonly productId?: string | undefined;
    readonly products: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    readonly materialId: string;
    readonly returnHref: Route;
  },
  request: typeof requestSeriesOrder = requestSeriesOrder,
): Promise<MaterialPreviewRoutePresentation | "unauthorized" | null> {
  const { products, materialId, returnHref } = input;
  const product =
    products.find(({ id }) => id === input.productId) ?? products[0];
  if (product === undefined) return null;
  const order = await getSeriesOrder(product.id, input.accessToken, request);
  if (order.kind === "unauthorized") return "unauthorized";
  if (order.kind === "not_found") {
    return { kind: "unavailable", reference: "product-not-found" };
  }
  if (order.kind === "error") {
    return { kind: "unavailable", reference: order.reference };
  }
  return (
    buildMaterialPreviewRoute({
      currentMaterialId: materialId,
      hrefOf: (id) => authoringMaterialPreviewHref(id, returnHref, product.id),
      order: order.order,
      otherProducts: products
        .filter(({ id }) => id !== product.id)
        .map(({ id, name }) => ({
          href: authoringMaterialPreviewHref(materialId, returnHref, id),
          name,
        })),
      // Состав изменился между двумя чтениями: материал уже не в этом руководстве.
    }) ?? { kind: "unavailable", reference: "product-order-changed" }
  );
}

/** Сбой чтения видео не прячет предпросмотр: строка о видео честно называет неизвестность. */
export async function getMaterialPreviewVideo(
  materialId: string,
  accessToken: string,
  request: typeof requestCurrentMaterial = requestCurrentMaterial,
): Promise<MaterialPreviewVideo> {
  let current: BackendTransportResult;
  try {
    current = await request(materialId, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
  if (!current.ok) return { kind: "unavailable" };
  const parsed = currentVideoSchema.safeParse(current.body);
  if (!parsed.success) return { kind: "unavailable" };
  const video = parsed.data.primaryVideo;
  return video === null
    ? { kind: "none" }
    : {
        durationSeconds: video.durationSeconds,
        kind: "attached",
        ready: video.state === "ready",
        title: video.title,
        videoId: video.videoId,
      };
}
