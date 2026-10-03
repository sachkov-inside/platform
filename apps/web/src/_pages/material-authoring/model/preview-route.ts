import type { Route } from "next";

import type { SeriesOrderPresentation } from "@/features/series-order";
import type {
  MaterialPreviewRouteItem,
  MaterialPreviewRoutePresentation,
  MaterialPreviewRouteSection,
} from "@/widgets/material-authoring/model";

const outsideChaptersName = "Вне глав";

type GuideOrder = Pick<SeriesOrderPresentation, "chapters" | "items" | "name">;

/**
 * Маршрут руководства для авторского предпросмотра. Порядок показа повторяет страницу
 * руководства: главы в объявленном порядке, затем материалы вне глав; «назад» и «дальше» идут по
 * этому же порядку, поэтому список и переходы не расходятся. Пустая глава остаётся видимой.
 * Материал, которого в составе нет, маршрута не получает.
 */
export function buildMaterialPreviewRoute(input: {
  readonly currentMaterialId: string;
  readonly hrefOf: (materialId: string) => Route;
  readonly order: GuideOrder;
  readonly otherGuides: readonly {
    readonly href: Route;
    readonly name: string;
  }[];
}): Extract<MaterialPreviewRoutePresentation, { kind: "ready" }> | null {
  const { currentMaterialId, hrefOf, order } = input;
  const chapterIds = new Set(order.chapters.map(({ id }) => id));
  const itemsOf = (
    belongs: (chapterId: string | null) => boolean,
  ): readonly MaterialPreviewRouteItem[] =>
    order.items
      .filter((item) => belongs(item.chapterId ?? null))
      .map((item) => ({
        current: item.materialId === currentMaterialId,
        href: hrefOf(item.materialId),
        publicationState: item.publicationState,
        title: item.title,
      }));
  const outside = itemsOf(
    (chapterId) => chapterId === null || !chapterIds.has(chapterId),
  );
  const chapters: readonly MaterialPreviewRouteSection[] = order.chapters.map(
    (chapter) => ({
      chapterId: chapter.id,
      items: itemsOf((chapterId) => chapterId === chapter.id),
      name: chapter.name,
    }),
  );
  const sections: readonly MaterialPreviewRouteSection[] =
    outside.length === 0
      ? chapters
      : [
          ...chapters,
          {
            chapterId: null,
            items: outside,
            name: order.chapters.length === 0 ? null : outsideChaptersName,
          },
        ];
  const sequence = sections.flatMap(({ items }) => items);
  const index = sequence.findIndex(({ current }) => current);
  if (index < 0) return null;
  return {
    guideName: order.name,
    kind: "ready",
    next: sequence[index + 1] ?? null,
    otherGuides: input.otherGuides,
    position: index + 1,
    previous: sequence[index - 1] ?? null,
    sections,
    total: sequence.length,
  };
}
