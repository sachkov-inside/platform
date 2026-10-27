"use client";

import { ContentCoverImage } from "@/entities/material";
import {
  HomeProductPinButton,
  type useHomePin,
} from "@/features/product-order";
import { formatCountRu } from "@/shared/lib/moscow-format";
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
 * Таблица продуктов. Колонки берутся из `productListColumnIds` по порядку: новая колонка
 * добавляется туда и в `productColumns`, а строка получает своё поле в `ProductListRow`.
 * `saleLoading`: продажи каталога ещё читаются, и неизвестный этап показан заглушкой, а не «Неизвестно».
 */
export function ProductsTable({
  rows,
  homePin,
  saleLoading = false,
}: {
  readonly rows: readonly ProductListRow[];
  readonly homePin: HomePinState;
  readonly saleLoading?: boolean;
}) {
  const pinnedId = homePin.controls.pin?.productId ?? null;
  const columns = productListColumnIds.map(
    (id) => productColumns(pinnedId, saleLoading)[id],
  );
  return (
    <AdminTable
      actionsWidth="6rem"
      caption="Все продукты"
      columns={columns}
      mobileItem={(row) => ({
        title: row.name,
        caption: row.caption,
        ...(row.sale === null
          ? {}
          : { badge: <StateBadge state={row.sale} /> }),
        metric:
          row.holders === null
            ? `Опубликовано: ${String(row.publishedMaterialCount)}`
            : `${formatCountRu(row.holders, holderForms)} · опубликовано ${String(row.publishedMaterialCount)}`,
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

const holderForms = ["обладатель", "обладателя", "обладателей"] as const;
const holderCountFormat = new Intl.NumberFormat("ru-RU");

function productColumns(
  pinnedId: string | null,
  saleLoading: boolean,
): Record<ProductListColumnId, AdminTableColumn<ProductListRow>> {
  return {
    name: { id: "name", header: "Название", cell: (row) => row.caption },
    sale: {
      id: "sale",
      header: "Продажа",
      width: "10rem",
      cell: (row) =>
        row.sale !== null ? (
          <StateBadge state={row.sale} />
        ) : saleLoading ? (
          <>
            <span
              aria-hidden="true"
              className="admin-skeleton-bar block w-24"
            />
            <span className="sr-only">Загружаем продажу</span>
          </>
        ) : (
          <NotKnown label="Неизвестно" />
        ),
    },
    holders: {
      id: "holders",
      header: "Обладатели",
      width: "8rem",
      align: "end",
      cell: (row) => (
        <span className="tabular-nums">
          {row.holders === null ? (
            <NotKnown label="Нет данных" />
          ) : (
            holderCountFormat.format(row.holders)
          )}
        </span>
      ),
    },
    published: {
      id: "published",
      header: "Опубликовано",
      width: "9rem",
      align: "end",
      cell: (row) => (
        <span className="tabular-nums">
          {String(row.publishedMaterialCount)}
        </span>
      ),
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

/** Неизвестное значение словами, приглушённо: пропуск не выглядит нулём или отказом. */
function NotKnown({ label }: { readonly label: string }) {
  return <span className="text-muted-foreground">{label}</span>;
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
