"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { billingActionClass, type PriceSnapshot } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { ContentCoverImage } from "@/entities/material";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type PublishedSeriesResult } from "@/features/library-discovery";
import { guideProductHref, guideProgrammeHref, purchaseInvitation, type PurchaseInvitation } from "@/shared/routing/subscription-route";
import "./guide-programme-view.css";

import { formatChapterCount } from "./guide-counts";
import { SeriesJourney, type SeriesLearningView } from "./series-journey.client";

type ResolvedSeriesResult = Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;

/**
 * Программа руководства: главы, материалы и состояния доступа. Продажа живёт здесь одним
 * приглашением: страница продукта продаёт смыслом, цену и оформление показывает страница оплаты.
 */
export function GuideProgrammeView({
  artifacts,
  result,
  learning,
  guideOffer = null,
  pending,
  subscriptionOffered = false,
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedSeriesResult;
  readonly learning?: SeriesLearningView;
  readonly guideOffer?: PriceSnapshot | null;
  /**
   * Программа нарисована из общих данных, личная часть ещё идёт (ADR 0027): состав и названия
   * настоящие, а замки, счётчик открытого, приглашение к оплате и прогресс уточняются на месте.
   * `purchaseRowExpected` — держать ли место под строку приглашения, чтобы шапка потом не выросла.
   */
  readonly pending?: { readonly purchaseRowExpected: boolean };
  readonly subscriptionOffered?: boolean;
}) {
  const accessPending = pending !== undefined;
  const slug = result.reference.slug;
  const currentHref = guideProgrammeHref(slug);
  const productHref = guideProductHref(slug);
  const items = result.kind === "ready" ? result.items : [];
  const availableCount = items.filter((item) => item.availability === "available").length;
  const purchase = accessPending ? null : programmePurchase({ guideOffer, result, subscriptionOffered });
  const showsPurchaseRow = pending === undefined ? purchase !== null : pending.purchaseRowExpected;
  const meta = [
    result.chapters.length === 0 ? undefined : formatChapterCount(result.chapters.length),
    formatMaterialCount(items.length),
    accessPending || availableCount === 0 ? undefined : availableCount === items.length ? "всё открыто" : `открыто: ${String(availableCount)}`,
  ].filter((value): value is string => value !== undefined);

  return (
    <div
      className="@container/programme mx-auto min-w-0 w-full max-w-[46rem]"
      data-guide-programme={slug}
    >
      <nav aria-label="Путь навигации" className="pt-4" data-programme-part="back">
        <IntentPrefetchLink
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
          href={productHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span>О продукте</span>
        </IntentPrefetchLink>
      </nav>

      <header className="mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5" data-programme-part="header">
        <div className="flex items-center gap-4 @max-[20rem]/programme:flex-col @max-[20rem]/programme:items-start">
          <div className="w-16 shrink-0 overflow-hidden rounded-lg sm:w-20"><ContentCoverImage alt="" className="aspect-square min-h-0 w-full" cover={result.reference.cover ?? null} fallbackKind="playlist" fallbackSeed={slug} /></div>
          <div className="min-w-0 [overflow-wrap:anywhere]"><h1 className="break-words text-xl font-semibold leading-tight tracking-[-0.025em] sm:text-2xl">{result.reference.name}</h1><p className="mt-2 text-xs leading-5 text-muted-foreground sm:text-sm">{meta.join(" · ")}</p></div>
        </div>
        {showsPurchaseRow ? <div className="mt-4 flex min-h-11 justify-end" data-programme-purchase-row>{purchase === null ? null : <ProgrammePurchase invitation={purchase} offer={guideOffer} />}</div> : null}
        {learning === undefined || learning.kind === "guest" ? null : <div className="mt-4 min-h-12 border-t border-border pt-3">
          {learning.kind === "ready" && learning.total > 0 ? <>
            <div className="mb-2 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span>Изучено {learning.read} из {learning.total}</span><span>{Math.round(100 * learning.read / learning.total)}%</span></div>
            <progress aria-label="Прогресс продукта" className="block h-1.5 w-full overflow-hidden rounded-full accent-primary" max={learning.total} value={learning.read} />
          </> : learning.kind === "loading" ? <p className="text-xs text-muted-foreground" role="status">Загружаем прогресс…</p> : learning.kind === "unavailable" ? <p className="text-xs text-muted-foreground">Прогресс сейчас не загрузился. Материалы можно читать.</p> : null}
        </div>}
      </header>


      <SeriesJourney
        accessPending={accessPending}
        {...(artifacts === undefined ? {} : { artifacts })}
        currentHref={currentHref}
        {...(learning === undefined ? {} : { learning })}
        result={{ ...result, discoveryKind: "series" }}
      />
    </div>
  );
}

/** Есть ли в программе урок под замком для того, чьими глазами прочитан состав. */
export function hasLockedItems(result: ResolvedSeriesResult): boolean {
  return result.kind === "ready" && result.items.some((item) => item.availability === "locked");
}

/**
 * Приглашение к оплате программы или `null`, когда приглашать не к чему: всё открыто либо ничего не
 * продаётся. Куда вести, решает общее правило призыва к покупке.
 */
export function programmePurchase({
  guideOffer,
  result,
  subscriptionOffered,
}: {
  readonly guideOffer: PriceSnapshot | null;
  readonly result: ResolvedSeriesResult;
  readonly subscriptionOffered: boolean;
}): PurchaseInvitation | null {
  if (!hasLockedItems(result)) return null;
  const slug = result.reference.slug;
  return purchaseInvitation({
    // Витрина вернёт человека в программу, откуда он ушёл, а не на страницу продукта.
    from: guideProgrammeHref(slug),
    guide: { slug, sold: guideOffer !== null },
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
}: {
  readonly invitation: PurchaseInvitation;
  readonly offer: PriceSnapshot | null;
}) {
  if (invitation.kind === "subscription") {
    return (
      <Button asChild className={billingActionClass} variant="outline">
        <Link href={invitation.href}>Посмотреть тарифы</Link>
      </Button>
    );
  }
  return (
    <Button
      asChild
      className={`guide-purchase-cta ${billingActionClass}`}
      data-guide-offer={offer?.paymentOption.id}
    >
      <Link href={invitation.href}>Оплатить сейчас</Link>
    </Button>
  );
}
