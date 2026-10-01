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
    readonly guideId?: string | undefined;
    readonly guides: readonly { readonly id: string; readonly name: string }[];
    readonly materialId: string;
    readonly returnHref: Route;
  },
  request: typeof requestSeriesOrder = requestSeriesOrder,
): Promise<MaterialPreviewRoutePresentation | "unauthorized" | null> {
  const { guides, materialId, returnHref } = input;
  const guide = guides.find(({ id }) => id === input.guideId) ?? guides[0];
  if (guide === undefined) return null;
  const order = await getSeriesOrder(guide.id, input.accessToken, request);
  if (order.kind === "unauthorized") return "unauthorized";
  if (order.kind === "not_found") {
    return { kind: "unavailable", reference: "guide-not-found" };
  }
  if (order.kind === "error") {
    return { kind: "unavailable", reference: order.reference };
  }
  return (
    buildMaterialPreviewRoute({
      currentMaterialId: materialId,
      hrefOf: (id) => authoringMaterialPreviewHref(id, returnHref, guide.id),
      order: order.order,
      otherGuides: guides
        .filter(({ id }) => id !== guide.id)
        .map(({ id, name }) => ({
          href: authoringMaterialPreviewHref(materialId, returnHref, id),
          name,
        })),
      // Состав изменился между двумя чтениями: материал уже не в этом руководстве.
    }) ?? { kind: "unavailable", reference: "guide-order-changed" }
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
    : { kind: "attached", ready: video.state === "ready", title: video.title };
}
