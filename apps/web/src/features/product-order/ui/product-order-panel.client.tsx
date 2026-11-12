"use client";

import { ChapterAttachmentsEditor } from "./chapter-attachments-editor.client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { productOrderQueryOptions } from "../api/read-product-order.browser";
import { productOrderMaterialSearchQueryOptions } from "../model/product-order-material-search-query";
import { ProductOrderManager } from "./product-order-manager.client";
import { ProductOrderReadOnly } from "./product-order-read-only";
import { ProductTopicsEditor } from "./product-topics-editor.client";
export function ProductOrderPanel({
  productId,
  archived,
  readOnly = false,
}: {
  readonly productId: string;
  readonly archived: boolean;
  /** Состав, запись которого backend отклоняет: продукт перенесён из источника. */
  readonly readOnly?: boolean;
}) {
  const query = useQuery(productOrderQueryOptions(productId));
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
  const topics = (
    <ProductTopicsEditor
      items={order.items}
      key={`topics-${order.orderVersion}`}
      onRefresh={async () => {
        const refreshed = await query.refetch();
        return refreshed.isError || refreshed.data?.kind !== "ready"
          ? null
          : {
              orderVersion: refreshed.data.order.orderVersion,
              topics: refreshed.data.order.topics,
            };
      }}
      orderVersion={order.orderVersion}
      productId={productId}
      topics={order.topics}
    />
  );
  if (readOnly)
    return (
      <div className="grid gap-6">
        <ProductOrderReadOnly
          chapters={order.chapters}
          items={order.items}
          productId={productId}
          programmePlacements={order.programmePlacements}
        />
        {order.chapters.map((chapter) => (
          <ChapterAttachmentsEditor
            key={chapter.id}
            chapter={chapter}
            items={order.items}
            productId={productId}
            orderVersion={order.orderVersion}
            onRefresh={async () => {
              const refreshed = await query.refetch();
              if (refreshed.isError || refreshed.data?.kind !== "ready")
                return null;
              const freshChapter = refreshed.data.order.chapters.find(
                (entry) => entry.id === chapter.id,
              );
              return freshChapter === undefined
                ? null
                : {
                    orderVersion: refreshed.data.order.orderVersion,
                    materialIds: freshChapter.supplementaryMaterialIds ?? [],
                  };
            }}
          />
        ))}
        {topics}
      </div>
    );
  return (
    <div className="grid gap-6">
      <ProductOrderManager
        key={order.orderVersion}
        embedded
        createMaterialSearchQueryOptions={
          productOrderMaterialSearchQueryOptions
        }
        onBack={() => undefined}
        onRefresh={() => {
          void query.refetch();
        }}
        onSelectPlaylist={() => undefined}
        presentation={{
          ...order,
          archived,
          options: [{ label: order.name, value: order.productId }],
        }}
      />
      {topics}
    </div>
  );
}
