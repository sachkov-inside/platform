"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import {
  billingActionClass,
  formatKopecks,
  type PriceSnapshot,
} from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import { internalRoute } from "@/shared/routing/internal-route";
import { guidePurchaseHref, subscriptionHrefFrom } from "@/shared/routing/subscription-route";
import { Button } from "@/shared/ui/button";

import { SeriesJourney, type SeriesLearningView } from "./series-journey.client";

type ResolvedSeriesResult = Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;

/**
 * Программа руководства: главы, материалы и состояния доступа. Цена встречает читателя здесь,
 * рядом с бесплатными материалами и замками, — страница продукта продаёт смыслом и цены не
 * показывает.
 */
export function GuideProgrammeView({
  artifacts,
  result,
  learning,
  guideOffer = null,
  onRetry,
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedSeriesResult;
  readonly learning?: SeriesLearningView;
  /** Разовая цена этого руководства, когда владелец её завёл. */
  readonly guideOffer?: PriceSnapshot | null;
  readonly onRetry?: (() => void) | undefined;
}) {
  const slug = result.reference.slug;
  const currentHref = internalRoute(`/guides/${encodeURIComponent(slug)}/programme`);
  const productHref = internalRoute(`/guides/${encodeURIComponent(slug)}`);
  const locked =
    result.kind === "ready" && result.items.some((item) => item.availability === "locked");

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

      <h1 className="mt-5 break-words text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.035em] md:text-4xl">
        Программа
      </h1>

      {locked ? <ProgrammePurchase offer={guideOffer} slug={slug} /> : null}

      <SeriesJourney
        {...(artifacts === undefined ? {} : { artifacts })}
        currentHref={currentHref}
        {...(learning === undefined ? {} : { learning })}
        onRetry={onRetry}
        result={{ ...result, discoveryKind: "series" }}
      />
    </div>
  );
}

/**
 * Цена сверху программы. Она появляется там, где читателю чего-то не хватает: у кого руководство
 * уже открыто, тому предлагать покупку нечего. Без заведённой цены остаётся прежний путь —
 * подписка.
 */
function ProgrammePurchase({
  offer,
  slug,
}: {
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
}) {
  const subscriptionHref = subscriptionHrefFrom(
    collectionDiscoveryHref("series", slug, undefined),
  );
  if (offer === null) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <p className="text-sm leading-6 text-muted-foreground">
          Часть материалов открыта по подписке. Она открывает все опубликованные материалы и
          руководства.
        </p>
        <Button asChild className={`mt-3 ${billingActionClass}`} variant="outline">
          <Link href={subscriptionHref}>Посмотреть тарифы</Link>
        </Button>
      </section>
    );
  }
  return (
    <section
      className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-card"
      data-guide-offer={offer.paymentOption.id}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums tracking-[-0.03em]">
            {formatKopecks(offer.firstPriceKopecks)}
          </span>
          <span className="text-sm text-muted-foreground">разовая покупка</span>
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Открывает руководство целиком и навсегда. Подписку включать не нужно, и списаний по
          этой покупке не будет.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild className={billingActionClass}>
          <Link href={guidePurchaseHref(slug)}>
            Купить за {formatKopecks(offer.firstPriceKopecks)}
          </Link>
        </Button>
        <Link
          className="text-sm text-action underline underline-offset-4"
          href={subscriptionHref}
        >
          Посмотреть подписку
        </Link>
      </div>
    </section>
  );
}
