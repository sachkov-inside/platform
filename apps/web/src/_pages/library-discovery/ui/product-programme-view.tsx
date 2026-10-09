import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import {
  billingActionClass,
  PreorderPriceView,
  StartCountdownBadge,
  type PreorderPrice,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { ContentCoverImage } from "@/entities/material";
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
import "./product-programme-view.css";

import { formatChapterCount } from "./product-counts";
import {
  programmePreorderRowClass,
  programmePurchaseRowClass,
} from "./programme-purchase-row";
import { SeriesJourney } from "./series-journey";
import {
  PendingPurchaseRow,
  PendingSeriesLearning,
  ProgrammeProgress,
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
    <div
      className="programme-frame @container/programme mx-auto min-w-0 w-full max-w-[46rem]"
      data-product-programme={slug}
    >
      {/* Выход из прохождения — вверху слева, на витрину Inside: снизу у программы свои разделы,
          и случайно уйти на Главную нельзя. Страница продукта — справа, для тех, кто его изучает. */}
      <nav
        aria-label="Путь навигации"
        className="flex items-center justify-between gap-3 pt-4"
        data-programme-part="back"
      >
        <IntentPrefetchLink
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
          href="/"
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span>Inside</span>
        </IntentPrefetchLink>
        <IntentPrefetchLink
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline decoration-border underline-offset-4"
          href={productHref}
        >
          О продукте
        </IntentPrefetchLink>
      </nav>

      <header
        className="relative mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5"
        data-programme-part="header"
      >
        {preorder === null || accessPending ? null : (
          <StartCountdownBadge text={preorder.daysLeft} />
        )}
        {/* Обложка, название и кнопка оплаты стоят в одном ряду; на узком экране кнопка уходит
            под название и занимает всю ширину, чтобы до неё было удобно дотянуться. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 @[36rem]/programme:grid-cols-[auto_minmax(0,1fr)_auto] @max-[20rem]/programme:grid-cols-1">
          <div className="w-24 shrink-0 overflow-hidden rounded-xl ring-1 ring-border @[36rem]/programme:w-36">
            <ContentCoverImage
              alt=""
              className="aspect-[3/2] min-h-0 w-full"
              cover={result.reference.cover ?? null}
              fallbackKind="playlist"
              fallbackSeed={slug}
              priority
              sizes="9rem"
            />
          </div>
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h1 className="break-words text-xl font-semibold leading-tight tracking-[-0.025em] sm:text-2xl">
              {result.reference.name}
            </h1>
            <p className="mt-2 text-xs leading-5 text-muted-foreground sm:text-sm">
              {meta.join(" · ")}
            </p>
          </div>
          {accessPending ? (
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
          )}
        </div>
        <ProgrammeProgress />
      </header>

      <SeriesJourney
        accessPending={accessPending}
        {...(artifacts === undefined ? {} : { artifacts })}
        currentHref={currentHref}
        result={{ ...result, discoveryKind: "series" }}
      />
    </div>
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
      <Link href={invitation.href}>
        {preorder === null ? "Оплатить сейчас" : "Оформить предзаказ"}
      </Link>
    </Button>
  );
  // Пока поток набирается, рядом с кнопкой — цена предзаказа и зачёркнутая цена после старта.
  if (preorder === null) return button;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-4 [&>a]:w-full @[30rem]/programme:[&>a]:w-auto">
      <PreorderPriceView note={null} price={preorder} />
      {button}
    </div>
  );
}
