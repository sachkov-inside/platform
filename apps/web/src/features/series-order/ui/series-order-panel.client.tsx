"use client";

import { ChapterAttachmentsEditor } from "./chapter-attachments-editor.client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { seriesOrderQueryOptions } from "../api/read-series-order.browser";
import { seriesOrderMaterialSearchQueryOptions } from "../model/series-order-material-search-query";
import { SeriesOrderManager } from "./series-order-manager.client";
import { SeriesOrderReadOnly } from "./series-order-read-only";
export function SeriesOrderPanel({
  seriesId,
  archived,
  readOnly = false,
}: {
  readonly seriesId: string;
  readonly archived: boolean;
  /** Состав, запись которого backend отклоняет: продукт перенесён из источника. */
  readonly readOnly?: boolean;
}) {
  const query = useQuery(seriesOrderQueryOptions(seriesId));
  if (query.isPending)
    return (
      <p className="p-6" role="status">
        Загружаем материалы продукта…
      </p>
    );
  if (query.data?.kind !== "ready")
    return (
      <div className="p-6" role="alert">
        Не удалось открыть продукт.{" "}
        <Button
          onClick={() => {
            void query.refetch();
          }}
          type="button"
        >
          Повторить
        </Button>
      </div>
    );
  const order = query.data.order;
  if (readOnly)
    return (
      <div className="grid gap-6">
        <SeriesOrderReadOnly
          chapters={order.chapters}
          items={order.items}
          productId={seriesId}
          programmePlacements={order.programmePlacements}
        />
        {order.chapters.map((chapter) => (
          <ChapterAttachmentsEditor
            key={chapter.id}
            chapter={chapter}
            items={order.items}
            productId={seriesId}
            orderVersion={order.orderVersion}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        ))}
      </div>
    );
  return (
    <SeriesOrderManager
      key={order.orderVersion}
      embedded
      createMaterialSearchQueryOptions={seriesOrderMaterialSearchQueryOptions}
      onBack={() => undefined}
      onRefresh={() => {
        void query.refetch();
      }}
      onSelectPlaylist={() => undefined}
      presentation={{
        ...order,
        archived,
        options: [{ label: order.name, value: order.seriesId }],
      }}
    />
  );
}
