"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { billingActionClass, type PriceSnapshot } from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type PublishedSeriesResult } from "@/features/library-discovery";
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
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedSeriesResult;
  readonly learning?: SeriesLearningView;
  /** Разовая цена этого руководства, когда владелец её завёл. */
  readonly guideOffer?: PriceSnapshot | null;
}) {
  const slug = result.reference.slug;
  const currentHref = internalRoute(`/guides/${encodeURIComponent(slug)}/programme`);
  const productHref = internalRoute(`/guides/${encodeURIComponent(slug)}`);
  const items = result.kind === "ready" ? result.items : [];
  const locked = items.some((item) => item.availability === "locked");
  const free = items.find((item) => item.availability === "available");
  const meta = [
    result.chapters.length === 0
      ? undefined
      : `${String(result.chapters.length)} ${chapterWord(result.chapters.length)}`,
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
        {locked ? <ProgrammePurchase offer={guideOffer} slug={slug} /> : null}
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

function chapterWord(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail > 10 && tail < 20) return "глав";
  if (last === 1) return "глава";
  if (last > 1 && last < 5) return "главы";
  return "глав";
}

/**
 * Единственное действие продажи в программе. Цену и состав покупки показывает страница оплаты,
 * поэтому здесь только приглашение — читатель сначала видит бесплатные уроки и замки.
 * Без заведённой цены остаётся прежний путь: подписка.
 */
function ProgrammePurchase({
  offer,
  slug,
}: {
  readonly offer: PriceSnapshot | null;
  readonly slug: string;
}) {
  if (offer === null) {
    return (
      <Button asChild className={billingActionClass} variant="outline">
        <Link href={subscriptionHrefFrom(collectionDiscoveryHref("series", slug, undefined))}>
          Посмотреть тарифы
        </Link>
      </Button>
    );
  }
  return (
    <Button
      asChild
      className={`billing-invite h-auto min-h-11 rounded-full px-6 text-base font-semibold ${billingActionClass}`}
      data-guide-offer={offer.paymentOption.id}
    >
      <Link href={guidePurchaseHref(slug)}>Оплатить сейчас</Link>
    </Button>
  );
}
