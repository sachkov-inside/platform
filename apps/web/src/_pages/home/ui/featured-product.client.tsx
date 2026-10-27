"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Code2, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { useMaterialReading } from "@/entities/material";
import type { ProductPresentation } from "@/entities/product-page";
import { CourseFilm } from "@/features/ai-engineering-course";
import { AiFirstProcessArtwork } from "@/features/ai-first-product";
import { formatMaterialCount } from "@/features/library-discovery";
import {
  loadProductContinuation,
  productContinuationQueryKey,
} from "@/features/reading-progress";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import type { HomePinnedCollection } from "../model/home-view";
import { hasText } from "@/shared/lib/text";

/** Реестр оформлений карточки Главной (ADR 0026): оформление продукта выбирает её вид. */
const featuredCards: Record<
  ProductPresentation,
  (props: {
    readonly product: HomePinnedCollection;
    readonly courseCall?: ReactNode;
  }) => ReactNode
> = {
  default: DefaultFeaturedProduct,
  "ai-first-process": AiFirstFeaturedProduct,
  "ai-engineering-course": AiEngineeringFeaturedProduct,
};

export function FeaturedProduct({
  product,
  courseCall,
}: {
  readonly product: HomePinnedCollection;
  readonly courseCall?: ReactNode;
}) {
  const Card = featuredCards[product.presentation];
  return <Card product={product} courseCall={courseCall} />;
}

/** Compact course introduction leaves the library feed visible on the first screen. */
function AiEngineeringFeaturedProduct({
  product,
  courseCall,
}: {
  readonly product: HomePinnedCollection;
  readonly courseCall?: ReactNode;
}) {
  if (product.hero === null)
    return <DefaultFeaturedProduct product={product} />;
  const href = collectionDiscoveryHref("product", product.slug, "/");
  return (
    <section
      aria-labelledby="featured-title"
      className="home-product-course"
      data-product-presentation="ai-engineering-course"
    >
      <div className="home-course-heading">
        <h2 id="featured-title">
          <IntentPrefetchLink href={href}>{product.name}</IntentPrefetchLink>
        </h2>
        <p className="home-course-description">{product.hero.lead}</p>
      </div>
      <div className="home-course-visual">
        <IntentPrefetchLink
          href={href}
          className="home-course-film"
          aria-label={`Открыть курс ${product.name}`}
        >
          <CourseFilm />
        </IntentPrefetchLink>
        <div className="home-course-call">
          {courseCall ?? (
            <IntentPrefetchLink href={href} className="home-course-open">
              Открыть курс <ArrowRight aria-hidden="true" />
            </IntentPrefetchLink>
          )}
        </div>
      </div>
    </section>
  );
}

function AiFirstFeaturedProduct({
  product,
}: {
  readonly product: HomePinnedCollection;
}) {
  // Подписи карточки приходят из описания продукта; без них остаются название и краткое описание.
  const card = product.card;
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
        <h2 id="featured-title">{product.name}</h2>
        {card === null || card.subtitle === "" ? null : (
          <p className="home-product-subtitle">{card.subtitle}</p>
        )}
        {hasText(product.summary) ? (
          <p className="home-product-summary">{product.summary}</p>
        ) : null}
        <div className="home-product-actions">
          <span>{formatMaterialCount(product.count)}</span>
          <IntentPrefetchLink
            className="home-product-open"
            href={collectionDiscoveryHref("product", product.slug, "/")}
          >
            {open} <ArrowRight aria-hidden="true" />
          </IntentPrefetchLink>
          <ProductContinuation slug={product.slug} />
        </div>
      </div>
      <div className="home-product-visual">
        <div className="home-product-animation home-product-ai">
          <AiFirstProcessArtwork />
        </div>
        <div className="home-product-mobile-footer">
          <span>{formatMaterialCount(product.count)}</span>
          <ArrowRight aria-hidden="true" />
          <IntentPrefetchLink
            href={collectionDiscoveryHref("product", product.slug, "/")}
          >
            Открыть
          </IntentPrefetchLink>
        </div>
      </div>
    </section>
  );
}

function DefaultFeaturedProduct({
  product,
}: {
  readonly product: HomePinnedCollection;
}) {
  // Подпись действия приходит из описания продукта, если автор её написал.
  const open =
    product.card === null || product.card.action === ""
      ? "Открыть продукт"
      : product.card.action;
  return (
    <section className="home-product" aria-labelledby="featured-title">
      <div className="home-product-copy">
        <h2 id="featured-title">{product.name}</h2>
        {hasText(product.summary) ? <p>{product.summary}</p> : null}
        <div className="home-product-actions">
          <span>{formatMaterialCount(product.count)}</span>
          <IntentPrefetchLink
            className="home-product-open"
            href={collectionDiscoveryHref("product", product.slug, "/")}
          >
            {open} <ArrowRight aria-hidden="true" />
          </IntentPrefetchLink>
          <ProductContinuation slug={product.slug} />
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
    queryKey: productContinuationQueryKey(accountId, slug),
    queryFn: () => loadProductContinuation(slug),
    retry: false,
  });
  const continuation =
    !query.isError && query.data?.kind === "ready"
      ? query.data.continuation
      : null;
  return continuation === null ? null : (
    <IntentPrefetchLink href={productProgrammeHref(slug)}>
      Продолжить обучение <ArrowRight aria-hidden="true" />
    </IntentPrefetchLink>
  );
}
