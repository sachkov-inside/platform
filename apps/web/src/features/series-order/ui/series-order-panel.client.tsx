"use client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { seriesOrderQueryOptions } from "../api/read-series-order.browser";
import { seriesOrderMaterialSearchQueryOptions } from "../model/series-order-material-search-query";
import { SeriesOrderManager } from "./series-order-manager.client";
export function SeriesOrderPanel({
  seriesId,
  archived,
}: {
  readonly seriesId: string;
  readonly archived: boolean;
}) {
  const query = useQuery(seriesOrderQueryOptions(seriesId));
  if (query.isPending)
    return (
      <p className="p-6" role="status">
        Загружаем материалы серии…
      </p>
    );
  if (query.data?.kind !== "ready")
    return (
      <div className="p-6" role="alert">
        Не удалось открыть серию.{" "}
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
