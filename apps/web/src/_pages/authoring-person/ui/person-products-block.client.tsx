"use client";

import { LoaderCircle } from "lucide-react";

import { accessOriginLabels } from "@/entities/authoring-person";
import type { ProductAccessActions } from "@/features/product-access-actions";
import {
  formatMoscowDate,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";
import { StateBadge } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import type { PersonCard, PersonCardProduct } from "../model/person-card";
import {
  historyActorLabel,
  historyKindLabel,
} from "../model/person-card-presentation";
import { BlockUnavailable } from "./person-card-section";

/**
 * Продукты человека: состояние, способ первого получения, начало и история событий со временем,
 * автором и причиной. «Отозвать» стоит у открытого доступа, «Восстановить» у отозванного.
 */
export function PersonProductsBlock({
  actions,
  onRetry,
  products,
}: {
  readonly actions: ProductAccessActions;
  readonly onRetry: () => void;
  readonly products: PersonCard["products"];
}) {
  if (products.state === "unavailable")
    return <BlockUnavailable onRetry={onRetry} subject="Продукты и историю" />;
  if (products.items.length === 0)
    return (
      <p className="person-card-note">
        У человека пока нет продуктов. Выдать продукт можно кнопкой вверху
        карточки.
      </p>
    );
  return (
    <ul className="grid gap-3">
      {products.items.map((product) => (
        <li key={product.productId}>
          <ProductPanel actions={actions} product={product} />
        </li>
      ))}
    </ul>
  );
}

function ProductPanel({
  actions,
  product,
}: {
  readonly actions: ProductAccessActions;
  readonly product: PersonCardProduct;
}) {
  const headingId = `person-product-${product.productId}`;
  const preparing = actions.pendingProductId === product.productId;
  return (
    <article aria-labelledby={headingId} className="person-card-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1.5">
          <h3 id={headingId}>{product.name}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <StateBadge state={`access.${product.access}`} />
            <span>{accessOriginLabels[product.origin]}</span>
            <span>
              {product.firstIssuedAt === null
                ? "Дата начала неизвестна"
                : `С ${formatMoscowDate(product.firstIssuedAt)}`}
            </span>
          </div>
        </div>
        {product.access === "active" ? (
          <Button
            aria-busy={preparing}
            aria-label={`Отозвать доступ к «${product.name}»`}
            className="min-h-11 px-4"
            disabled={preparing}
            onClick={() => {
              actions.revoke(product.productId);
            }}
            type="button"
            variant="outline"
          >
            {preparing ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            Отозвать
          </Button>
        ) : (
          <Button
            aria-label={`Восстановить доступ к «${product.name}»`}
            className="min-h-11 px-4"
            onClick={() => {
              actions.restore(product.productId);
            }}
            type="button"
            variant="outline"
          >
            Восстановить
          </Button>
        )}
      </div>
      <ProductHistory product={product} />
    </article>
  );
}

function ProductHistory({ product }: { readonly product: PersonCardProduct }) {
  if (product.history.length === 0)
    return <p className="person-card-note">Событий в истории пока нет.</p>;
  return (
    <ol
      aria-label={`История «${product.name}»`}
      className="person-card-history"
    >
      {product.history.map((entry, index) => (
        <li key={`${entry.at}-${String(index)}`}>
          <span>
            <span className="font-medium">{historyKindLabel(entry.kind)}</span>
            {" · "}
            <time dateTime={entry.at}>{formatMoscowDateTime(entry.at)}</time>
          </span>
          <span className="text-muted-foreground">
            {historyActorLabel(entry.actor)}
            {entry.reason === null ? null : (
              <>
                {". Причина: "}
                <q className="text-foreground">{entry.reason}</q>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
