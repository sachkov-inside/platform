"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { billingActionClass, type PriceSnapshot } from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type PublishedSeriesResult } from "@/features/library-discovery";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import { guideProductHref, guideProgrammeHref, purchaseInvitation } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

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
  subscriptionOffered = false,
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedSeriesResult;
  readonly learning?: SeriesLearningView;
  /** Цена этого руководства, когда владелец её завёл и включил в продажу. */
  readonly guideOffer?: PriceSnapshot | null;
  /** Продаётся ли вообще подписка: выключенную звать нельзя, даже когда своей цены нет. */
  readonly subscriptionOffered?: boolean;
}) {
  const slug = result.reference.slug;
  const currentHref = guideProgrammeHref(slug);
  const productHref = guideProductHref(slug);
  const items = result.kind === "ready" ? result.items : [];
  const locked = items.some((item) => item.availability === "locked");
  const free = items.find((item) => item.availability === "available");
  const meta = [
    result.chapters.length === 0 ? undefined : formatChapterCount(result.chapters.length),
    formatMaterialCount(items.length),
    free === undefined ? undefined : "первый открыт",
  ].filter((value): value is string => value !== undefined);

  return (
    <div
      className="@container/programme mx-auto min-w-0 w-full max-w-[65rem]"
      data-guide-programme={slug}
    >
      <nav aria-label="Путь навигации" className="pt-4">
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold"
          href={productHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 break-words">{result.reference.name}</span>
        </Link>
      </nav>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">{meta.join(" · ")}</p>
        {locked ? (
          <ProgrammePurchase
            offer={guideOffer}
            slug={slug}
            subscriptionOffered={subscriptionOffered}
          />
        ) : null}
      </div>

      <SeriesJourney
        {...(artifacts === undefined ? {} : { artifacts })}
        currentHref={currentHref}
        {...(learning === undefined ? {} : { learning })}
        result={{ ...result, discoveryKind: "series" }}
      />
    </div>
  );
}


/**
 * Единственное действие продажи в программе. Цену и состав покупки показывает страница оплаты,
 * поэтому здесь только приглашение — читатель сначала видит бесплатные уроки и замки.
 * Куда вести, решает общее правило призыва к покупке: без заведённой цены остаётся прежний путь,
 * подписка, — но только пока она продаётся.
 */
function ProgrammePurchase({
  offer,
  slug,
  subscriptionOffered,
}: {
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
  readonly subscriptionOffered: boolean;
}) {
  const invitation = purchaseInvitation({
    from: collectionDiscoveryHref("series", slug, undefined),
    guide: { slug, sold: offer !== null },
    subscriptionOffered,
  });
  if (invitation === null) return null;
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
      className={`billing-invite h-auto min-h-11 rounded-full px-6 text-base font-semibold ${billingActionClass}`}
      data-guide-offer={offer?.paymentOption.id}
    >
      <Link href={invitation.href}>Оплатить сейчас</Link>
    </Button>
  );
}
