"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Code2, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { useMaterialReading } from "@/entities/material";
import type { GuidePresentation } from "@/entities/guide-page";
import { AiFirstProcessArtwork } from "@/features/ai-first-guide";
import { fillOneTimeTerms } from "@/features/billing-checkout.terms";
import { formatMaterialCount } from "@/features/library-discovery";
import {
  loadSeriesContinuation,
  seriesContinuationQueryKey,
} from "@/features/reading-progress";
import {
  collectionDiscoveryHref,
  materialReaderHref,
} from "@/shared/routing/material-reader";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import type { HomePinnedCollection } from "../model/home-view";

/** Реестр оформлений карточки Главной (ADR 0026): оформление продукта выбирает её вид. */
const featuredCards: Record<
  GuidePresentation,
  (props: { readonly series: HomePinnedCollection }) => ReactNode
> = {
  default: DefaultFeaturedGuide,
  "ai-first-process": AiFirstFeaturedGuide,
};

export function FeaturedGuide({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  const Card = featuredCards[series.presentation];
  return <Card series={series} />;
}

function AiFirstFeaturedGuide({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  // Подписи карточки приходят из описания продукта; без них остаются название и краткое описание.
  const card = series.card;
  const open =
    card === null || card.action === ""
      ? "Открыть продукт"
      : fillOneTimeTerms(card.action);
  return (
    <section
      className="home-guide home-guide-featured-ai"
      aria-labelledby="featured-title"
      data-guide-presentation="ai-first-process"
    >
      <div className="home-guide-copy">
        {card === null || card.eyebrow === "" ? null : (
          <p className="home-guide-eyebrow">{fillOneTimeTerms(card.eyebrow)}</p>
        )}
        <h2 id="featured-title">{series.name}</h2>
        {card === null || card.subtitle === "" ? null : (
          <p className="home-guide-subtitle">
            {fillOneTimeTerms(card.subtitle)}
          </p>
        )}
        {series.summary && (
          <p className="home-guide-summary">{series.summary}</p>
        )}
        <div className="home-guide-actions">
          <span>{formatMaterialCount(series.count)}</span>
          <IntentPrefetchLink
            className="home-guide-open"
            href={collectionDiscoveryHref("series", series.slug, "/")}
          >
            {open} <ArrowRight aria-hidden="true" />
          </IntentPrefetchLink>
          <GuideContinuation slug={series.slug} />
        </div>
      </div>
      <div className="home-guide-visual">
        <div className="home-guide-animation home-guide-ai">
          <AiFirstProcessArtwork />
        </div>
        <div className="home-guide-mobile-footer">
          <span>{formatMaterialCount(series.count)}</span>
          <ArrowRight aria-hidden="true" />
          <IntentPrefetchLink
            href={collectionDiscoveryHref("series", series.slug, "/")}
          >
            Открыть
          </IntentPrefetchLink>
        </div>
      </div>
    </section>
  );
}

function DefaultFeaturedGuide({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  // Подпись действия приходит из описания продукта, если автор её написал.
  const open =
    series.card === null || series.card.action === ""
      ? "Открыть продукт"
      : fillOneTimeTerms(series.card.action);
  return (
    <section className="home-guide" aria-labelledby="featured-title">
      <div className="home-guide-copy">
        <h2 id="featured-title">{series.name}</h2>
        {series.summary && <p>{series.summary}</p>}
        <div className="home-guide-actions">
          <span>{formatMaterialCount(series.count)}</span>
          <IntentPrefetchLink
            className="home-guide-open"
            href={collectionDiscoveryHref("series", series.slug, "/")}
          >
            {open} <ArrowRight aria-hidden="true" />
          </IntentPrefetchLink>
          <GuideContinuation slug={series.slug} />
        </div>
      </div>
      <div className="home-guide-animation">
        <div className="home-guide-scenes" aria-hidden="true">
          <div className="home-guide-scene home-guide-scene-task">
            <Terminal />
            <p>
              Собрать приложение.
              <br />
              От идеи до запуска.
            </p>
            <div className="home-guide-prompt">
              Разберёмся с требованиями
              <ArrowRight />
            </div>
          </div>
          <div className="home-guide-scene home-guide-scene-agent">
            <Code2 />
            <p>
              Планируем.
              <br />
              Пишем. Разбираемся.
            </p>
            <div className="home-guide-code">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="home-guide-scene home-guide-scene-checks">
            <Check />
            <p>
              Код работает.
              <br />
              Теперь проверим почему.
            </p>
            <ul>
              <li>
                <Check /> Тесты
              </li>
              <li>
                <Check /> Ревью
              </li>
              <li>
                <Check /> Сборка
              </li>
            </ul>
          </div>
          <div className="home-guide-scene home-guide-scene-app">
            <div className="home-guide-app">
              <div>
                <span />
                <span />
                <span />
              </div>
              <strong>Приложение запущено</strong>
              <p>От задачи — к результату</p>
              <div className="home-guide-app-content">
                <Check /> Всё готово к следующему шагу
              </div>
            </div>
          </div>
        </div>
        <div className="home-guide-animation-caption">
          <span>Задача → агент → проверки → приложение</span>
        </div>
      </div>
    </section>
  );
}

function GuideContinuation({ slug }: { readonly slug: string }) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : null;
  return (
    <div className="home-guide-continue">
      {accountId === null ? null : (
        <AccountGuideContinuation
          key={accountId}
          accountId={accountId}
          slug={slug}
        />
      )}
    </div>
  );
}

function AccountGuideContinuation({
  accountId,
  slug,
}: {
  readonly accountId: string;
  readonly slug: string;
}) {
  const query = useQuery({
    queryKey: seriesContinuationQueryKey(accountId, slug),
    queryFn: () => loadSeriesContinuation(slug),
    retry: false,
  });
  const continuation =
    !query.isError && query.data?.kind === "ready"
      ? query.data.continuation
      : null;
  return continuation === null ? null : (
    <IntentPrefetchLink
      href={materialReaderHref(
        continuation.materialSlug,
        guideProgrammeHref(slug),
      )}
    >
      Продолжить обучение <ArrowRight aria-hidden="true" />
    </IntentPrefetchLink>
  );
}
