import Link from "next/link";

import {
  billingActionClass,
  PreorderPriceView,
  StartCountdownBadge,
  type PreorderPrice,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import {
  formatMaterialCount,
  type PublishedSeriesResult,
} from "@/features/library-discovery";
import {
  productHref as productPageHref,
  productProgrammeHref,
  purchaseInvitation,
  type PurchaseInvitation,
} from "@/shared/routing/subscription-route";
import { ProductProgrammeFrame } from "./product-programme-frame";

import { formatChapterCount } from "./product-counts";
import {
  programmePreorderRowClass,
  programmePurchaseRowClass,
} from "./programme-purchase-row";
import { SeriesJourney } from "./series-journey";
import {
  PendingPurchaseRow,
  PendingSeriesLearning,
} from "./series-learning.client";

type ResolvedSeriesResult = Extract<
  PublishedSeriesResult,
  { kind: "ready" | "empty" }
>;

/**
 * Программа руководства: главы, материалы и состояния доступа. Продажа живёт здесь одним
 * приглашением: страница продукта продаёт смыслом, цену и оформление показывает страница оплаты.
 * Программу рисует сервер; прогресс читателя приходит в браузере через `SeriesLearningProvider`.
 */
export function ProductProgrammeView({
  artifacts,
  result,
  preorder = null,
  productOffer = null,
  pending: accessPending = false,
  subscriptionOffered = false,
}: {
  readonly artifacts?: ReaderProductArtifactsResult;
  readonly result: ResolvedSeriesResult;
  readonly productOffer?: PriceSnapshot | null;
  /** Цена предзаказа: пока поток набирается, кнопка оплаты становится предзаказом. */
  readonly preorder?: PreorderPrice | null;
  /**
   * Программа нарисована из общих данных, личная часть ещё идёт (ADR 0027): состав и названия
   * настоящие, а замки, счётчик открытого, приглашение к оплате и прогресс уточняются на месте.
   */
  readonly pending?: boolean;
  readonly subscriptionOffered?: boolean;
}) {
  const slug = result.reference.slug;
  const currentHref = productProgrammeHref(slug);
  const productHref = productPageHref(slug);
  const items = result.kind === "ready" ? result.items : [];
  const availableCount = items.filter(
    (item) => item.availability === "available",
  ).length;
  const purchase = accessPending
    ? null
    : programmePurchase({ productOffer, result, subscriptionOffered });
  const meta = [
    result.chapters.length === 0
      ? undefined
      : formatChapterCount(result.chapters.length),
    formatMaterialCount(items.length),
    accessPending || availableCount === 0
      ? undefined
      : availableCount === items.length
        ? "всё открыто"
        : `открыто: ${String(availableCount)}`,
  ].filter((value): value is string => value !== undefined);

  return (
    <ProductProgrammeFrame
      courseMark={
        result.reference.productPage?.presentation === "ai-engineering-course"
      }
      meta={meta.join(" · ")}
      name={result.reference.name}
      productHref={productHref}
      purchase={
        accessPending ? (
          <PendingPurchaseRow
            lockedForGuest={hasLockedItems(result)}
            slug={slug}
          />
        ) : purchase === null ? null : (
          <div
            className={
              preorder === null
                ? programmePurchaseRowClass
                : programmePreorderRowClass
            }
            data-programme-purchase-row
          >
            <ProgrammePurchase
              invitation={purchase}
              offer={productOffer}
              preorder={preorder}
            />
          </div>
        )
      }
      slug={slug}
      startBadge={
        preorder === null || accessPending ? null : (
          <StartCountdownBadge text={preorder.daysLeft} />
        )
      }
    >
      <SeriesJourney
        accessPending={accessPending}
        {...(artifacts === undefined ? {} : { artifacts })}
        currentHref={currentHref}
        result={{ ...result, discoveryKind: "series" }}
      />
    </ProductProgrammeFrame>
  );
}

/** Программа на общих данных, пока личная часть идёт (ADR 0027). */
export function PendingSeries({
  artifacts,
  result,
}: {
  readonly artifacts: ReaderProductArtifactsResult;
  readonly result: ResolvedSeriesResult;
}) {
  return (
    <PendingSeriesLearning>
      <ProductProgrammeView artifacts={artifacts} pending result={result} />
    </PendingSeriesLearning>
  );
}

/** Есть ли в программе урок под замком для того, чьими глазами прочитан состав. */
function hasLockedItems(result: ResolvedSeriesResult): boolean {
  return (
    result.kind === "ready" &&
    result.items.some((item) => item.availability === "locked")
  );
}

/**
 * Приглашение к оплате программы или `null`, когда приглашать не к чему: всё открыто либо ничего не
 * продаётся. Куда вести, решает общее правило призыва к покупке.
 */
export function programmePurchase({
  productOffer,
  result,
  subscriptionOffered,
}: {
  readonly productOffer: PriceSnapshot | null;
  readonly result: ResolvedSeriesResult;
  readonly subscriptionOffered: boolean;
}): PurchaseInvitation | null {
  if (!hasLockedItems(result)) return null;
  const slug = result.reference.slug;
  return purchaseInvitation({
    // Витрина вернёт человека в программу, откуда он ушёл, а не на страницу продукта.
    from: productProgrammeHref(slug),
    product: { slug, sold: productOffer !== null },
    subscriptionOffered,
  });
}

/**
 * Единственное действие продажи в программе. Цену и состав покупки показывает страница оплаты,
 * поэтому здесь только приглашение — читатель сначала видит бесплатные уроки и замки.
 * Куда вести, решает общее правило призыва к покупке: без заведённой цены остаётся прежний путь,
 * подписка, — но только пока она продаётся.
 */
function ProgrammePurchase({
  invitation,
  offer,
  preorder,
}: {
  readonly invitation: PurchaseInvitation;
  readonly offer: PriceSnapshot | null;
  readonly preorder: PreorderPrice | null;
}) {
  if (invitation.kind === "subscription") {
    return (
      <Button asChild className={billingActionClass} variant="outline">
        <Link href={invitation.href}>Посмотреть тарифы</Link>
      </Button>
    );
  }
  const button = (
    <Button
      asChild
      className={`product-purchase-cta ${billingActionClass}`}
      data-product-offer={offer?.paymentOption.id}
    >
      <Link href={invitation.href}>Оплатить сейчас</Link>
    </Button>
  );
  // Пока поток набирается, рядом с ценой — компактная оранжевая кнопка предзаказа справа: она не
  // спорит с широкой тёмной «Начать обучение» в списке уроков (решение владельца 09.10.2026).
  if (preorder === null) return button;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-4">
      <PreorderPriceView note={null} price={preorder} />
      <Link
        className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground no-underline transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Оформить предзаказ"
        data-product-offer={offer?.paymentOption.id}
        href={invitation.href}
      >
        {/* На телефоне коротко, чтобы кнопка встала в строку с ценой. */}
        <span className="sm:hidden">Предзаказ</span>
        <span className="max-sm:hidden">Оформить предзаказ</span>
      </Link>
    </div>
  );
}
