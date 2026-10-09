"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Code2, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { useMaterialReading } from "@/entities/material";
import type { ProductPresentation } from "@/entities/product-page";
import { StartCountdownBadge } from "@/entities/subscription";
import { CourseHero } from "@/features/ai-engineering-course";
import { AiFirstProcessArtwork } from "@/features/ai-first-product";
import { formatMaterialCount } from "@/features/library-discovery";
import {
  loadSeriesContinuation,
  seriesContinuationQueryKey,
} from "@/features/reading-progress";
import {
  collectionDiscoveryHref,
  materialReaderHref,
} from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import type { HomePinnedCollection } from "../model/home-view";
import { hasText } from "@/shared/lib/text";

/** Реестр оформлений карточки Главной (ADR 0026): оформление продукта выбирает её вид. */
const featuredCards: Record<
  ProductPresentation,
  (props: { readonly series: HomePinnedCollection }) => ReactNode
> = {
  default: DefaultFeaturedProduct,
  "ai-first-process": AiFirstFeaturedProduct,
  "ai-engineering-course": AiEngineeringFeaturedProduct,
};

export function FeaturedProduct({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  const Card = featuredCards[series.presentation];
  return <Card series={series} />;
}

/**
 * Карточка курса AI Engineering повторяет первый экран страницы курса: тот же модуль, те же тексты
 * из описания продукта и та же анимация. Без первого экрана в описании — общий вид карточки.
 */
function AiEngineeringFeaturedProduct({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  if (series.hero === null) return <DefaultFeaturedProduct series={series} />;
  // Сроки предложения в текстах уже подставлены сервером Главной.
  const hero = series.hero;
  const open =
    series.card === null || series.card.action === ""
      ? "Открыть курс"
      : series.card.action;
  return (
    <section
      aria-labelledby="featured-title"
      className="home-product-course"
      data-product-presentation="ai-engineering-course"
    >
      <CourseHero
        action={{
          href: collectionDiscoveryHref("series", series.slug, "/"),
          label: open,
        }}
        badge={hero.badge}
        heading="h2"
        headingId="featured-title"
        highlights={hero.highlights}
        lead={hero.lead}
        name={series.name}
        filmBadge={
          series.startCountdown === undefined ||
          series.startCountdown === null ? null : (
            <StartCountdownBadge text={series.startCountdown} />
          )
        }
      />
    </section>
  );
}

function AiFirstFeaturedProduct({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  // Подписи карточки приходят из описания продукта; без них остаются название и краткое описание.
  const card = series.card;
  const open =
    card === null || card.action === "" ? "Открыть продукт" : card.action;
  return (
    <section
      className="home-product home-product-featured-ai"
      aria-labelledby="featured-title"
      data-product-presentation="ai-first-process"
    >
      <div className="home-product-copy">
        {card === null || card.eyebrow === "" ? null : (
          <p className="home-product-eyebrow">{card.eyebrow}</p>
        )}
        <h2 id="featured-title">{series.name}</h2>
        {card === null || card.subtitle === "" ? null : (
          <p className="home-product-subtitle">{card.subtitle}</p>
        )}
        {hasText(series.summary) ? (
          <p className="home-product-summary">{series.summary}</p>
        ) : null}
        <div className="home-product-actions">
          <span>{formatMaterialCount(series.count)}</span>
          <IntentPrefetchLink
            className="home-product-open"
            href={collectionDiscoveryHref("series", series.slug, "/")}
          >
            {open} <ArrowRight aria-hidden="true" />
          </IntentPrefetchLink>
          <ProductContinuation slug={series.slug} />
        </div>
      </div>
      <div className="home-product-visual">
        <div className="home-product-animation home-product-ai">
          <AiFirstProcessArtwork />
        </div>
        <div className="home-product-mobile-footer">
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

function DefaultFeaturedProduct({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  // Подпись действия приходит из описания продукта, если автор её написал.
  const open =
    series.card === null || series.card.action === ""
      ? "Открыть продукт"
      : series.card.action;
  return (
    <section className="home-product" aria-labelledby="featured-title">
      <div className="home-product-copy">
        <h2 id="featured-title">{series.name}</h2>
        {hasText(series.summary) ? <p>{series.summary}</p> : null}
        <div className="home-product-actions">
          <span>{formatMaterialCount(series.count)}</span>
          <IntentPrefetchLink
            className="home-product-open"
            href={collectionDiscoveryHref("series", series.slug, "/")}
          >
            {open} <ArrowRight aria-hidden="true" />
          </IntentPrefetchLink>
          <ProductContinuation slug={series.slug} />
        </div>
      </div>
      <div className="home-product-animation">
        <div className="home-product-scenes" aria-hidden="true">
          <div className="home-product-scene home-product-scene-task">
            <Terminal />
            <p>
              Собрать приложение.
              <br />
              От идеи до запуска.
            </p>
            <div className="home-product-prompt">
              Разберёмся с требованиями
              <ArrowRight />
            </div>
          </div>
          <div className="home-product-scene home-product-scene-agent">
            <Code2 />
            <p>
              Планируем.
              <br />
              Пишем. Разбираемся.
            </p>
            <div className="home-product-code">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="home-product-scene home-product-scene-checks">
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
          <div className="home-product-scene home-product-scene-app">
            <div className="home-product-app">
              <div>
                <span />
                <span />
                <span />
              </div>
              <strong>Приложение запущено</strong>
              <p>От задачи — к результату</p>
              <div className="home-product-app-content">
                <Check /> Всё готово к следующему шагу
              </div>
            </div>
          </div>
        </div>
        <div className="home-product-animation-caption">
          <span>Задача → агент → проверки → приложение</span>
        </div>
      </div>
    </section>
  );
}

function ProductContinuation({ slug }: { readonly slug: string }) {
  const reading = useMaterialReading();
  const accountId = reading.resolved ? reading.accountId : null;
  return (
    <div className="home-product-continue">
      {accountId === null ? null : (
        <AccountProductContinuation
          key={accountId}
          accountId={accountId}
          slug={slug}
        />
      )}
    </div>
  );
}

function AccountProductContinuation({
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
        productProgrammeHref(slug),
      )}
    >
      Продолжить обучение <ArrowRight aria-hidden="true" />
    </IntentPrefetchLink>
  );
}
