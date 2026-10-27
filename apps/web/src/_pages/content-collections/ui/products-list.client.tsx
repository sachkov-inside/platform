"use client";

import { ContentCoverImage } from "@/entities/material";
import {
  HomeProductPinButton,
  type useHomePin,
} from "@/features/product-order";
import { internalRoute } from "@/shared/routing/internal-route";
import {
  AdminRowMenu,
  AdminTable,
  StateBadge,
  type AdminTableColumn,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  productListColumnIds,
  type ProductListColumnId,
  type ProductListRow,
} from "../model/collection-list";
import {
  productPageTabIds,
  productPageTabSearch,
} from "../model/product-page-tabs";
import { productPageTabLabels } from "./product-page-tabs.client";

type HomePinState = ReturnType<typeof useHomePin>;

/**
 * Таблица продуктов. Колонки берутся из `productListColumnIds` по порядку: новая колонка (#1718)
 * добавляется туда и в `productColumns`, а строка получает своё поле в `ProductListRow`.
 */
export function ProductsTable({
  rows,
  homePin,
}: {
  readonly rows: readonly ProductListRow[];
  readonly homePin: HomePinState;
}) {
  const pinnedId = homePin.controls.pin?.productId ?? null;
  const columns = productListColumnIds.map(
    (id) => productColumns(pinnedId)[id],
  );
  return (
    <AdminTable
      actionsWidth="6rem"
      caption="Все продукты"
      columns={columns}
      mobileItem={(row) => ({
        title: row.name,
        caption: row.caption,
        badge: <StateBadge state={row.state} />,
        metric: `Опубликовано: ${String(row.publishedMaterialCount)}`,
      })}
      rowActions={(row) => (
        <>
          <HomeProductPinButton
            archived={row.archived}
            controls={homePin.controls}
            productId={row.id}
            productName={row.name}
          />
          <AdminRowMenu
            items={productPageTabIds.map((tab) => ({
              id: tab,
              label: productPageTabLabels[tab],
              href: internalRoute(
                `${row.href}${productPageTabSearch("", tab)}`,
              ),
            }))}
            label={`Действия с «${row.name}»`}
          />
        </>
      )}
      rowHref={(row) => row.href}
      rowKey={(row) => row.id}
      rows={rows}
      rowMedia={(row) =>
        row.cover === null ? null : (
          <ContentCoverImage
            alt=""
            className="aspect-video w-16"
            cover={row.cover}
            sizes="4rem"
          />
        )
      }
      rowTitle={(row) => row.name}
    />
  );
}

function productColumns(
  pinnedId: string | null,
): Record<ProductListColumnId, AdminTableColumn<ProductListRow>> {
  return {
    name: { id: "name", header: "Название", cell: (row) => row.caption },
    state: {
      id: "state",
      header: "Состояние",
      width: "8rem",
      cell: (row) => <StateBadge state={row.state} />,
    },
    published: {
      id: "published",
      header: "Опубликовано",
      width: "9rem",
      align: "end",
      cell: (row) => String(row.publishedMaterialCount),
    },
    home: {
      id: "home",
      header: "На главной",
      width: "9rem",
      cell: (row) =>
        row.id === pinnedId ? <StateBadge state="product.pinned" /> : null,
    },
  };
}

/**
 * Строка о закрепе над таблицей. Её высота не меняется между загрузкой, подсказкой и ошибкой,
 * поэтому таблица под ней не прыгает.
 */
export function HomePinNotice({ homePin }: { readonly homePin: HomePinState }) {
  const { hasError, message, retry } = homePin;
  return (
    <div
      className="grid min-h-28 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm text-muted-foreground sm:min-h-16"
      role={hasError ? "alert" : "status"}
    >
      <p>
        {hasError
          ? message
          : "Закреплённый продукт стоит первым на главной. Закрепите его значком в строке."}
      </p>
      <Button
        className={
          hasError
            ? "max-w-28 whitespace-normal"
            : "invisible max-w-28 whitespace-normal"
        }
        disabled={!hasError}
        onClick={retry}
        size="sm"
        type="button"
        variant="outline"
      >
        Обновить закреп
      </Button>
    </div>
  );
}
