import {
  ArrowRight,
  Check,
  Clock3,
  Code2,
  FileCode2,
  FolderGit2,
  GitPullRequest,
  MessagesSquare,
  Play,
  Server,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import type { ReactNode } from "react";

import type {
  ProductPage,
  ProductPageBlock,
  ProductPageBlockOf,
} from "@/entities/product-page";
import { AiFirstProcessArtwork } from "@/features/ai-first-product";
import {
  formatMaterialCount,
  type PublishedSeriesResult,
} from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";

import { countFreeLessons } from "../model/free-lessons";
import "./ai-first-product-view.css";
import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";

/**
 * Оформление `ai-first-process`: весь текст приходит из описания продукта, а оформление добавляет
 * к известным блокам свои иллюстрации и значки. Блок с другим `id` рисуется по своему виду.
 * Сроки доступа и помощи подставляет оферта, поэтому в тексте автор пишет только подстановку.
 */
export function AiFirstProductView({
  result,
  page,
  returnTarget,
}: {
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly page: ProductPage;
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  const freeCount = countFreeLessons(
    result.kind === "ready" ? result.items : [],
  );
  const context: BlockContext = {
    programme: productProgrammeHref(result.reference.slug),
    freeCount,
    name: result.reference.name,
  };
  return (
    <article
      className="ai-product-page"
      data-product-landing={result.reference.slug}
      data-product-presentation="ai-first-process"
    >
      {/* Страница продукта — витрина: без шапки телефона, как и страница курса. */}
      <HideMobileNavigation />
      <nav aria-label="Хлебные крошки">
        <CatalogBackLink href={returnTarget.href} label={returnTarget.label} />
      </nav>
      {/* Название продукта — заголовок страницы: его показывает hero, а без hero он всё равно нужен. */}
      {page.blocks.some((block) => block.kind === "hero") ? null : (
        <header className="ai-product-hero">
          <div className="ai-product-hero-copy">
            <h1>{result.reference.name}</h1>
          </div>
        </header>
      )}
      {page.blocks.map((block) => (
        <AiFirstBlock block={block} context={context} key={block.id} />
      ))}
      <div className="ai-product-sticky">
        <IntentPrefetchLink
          className="ai-product-button"
          href={context.programme}
        >
          Открыть программу
          <ArrowRight />
        </IntentPrefetchLink>
      </div>
    </article>
  );
}

interface BlockContext {
  readonly programme: Route;
  /** Сколько уроков продукта открыты без покупки: приглашение показывается только при них. */
  readonly freeCount: number;
  readonly name: string;
}

function AiFirstBlock({
  block,
  context,
}: {
  readonly block: ProductPageBlock;
  readonly context: BlockContext;
}): ReactNode {
  switch (block.kind) {
    case "hero":
      return <Hero block={block} context={context} />;
    case "cards":
      if (block.id === "outcomes") return <OutcomeCards block={block} />;
      if (block.id === "support") return <SupportCards block={block} />;
      if (block.id === "bonuses") return <BonusCards block={block} />;
      return <PlainCards block={block} />;
    case "text":
      return <TextSection block={block} />;
    case "steps":
      return <StepsSection block={block} context={context} />;
    case "list":
      return <ListSection block={block} />;
    case "trial":
      return context.freeCount === 0 ? null : (
        <section className="ai-product-trial">
          <h2>{block.title}</h2>
          <p>{block.text}</p>
          {block.link === "" ? null : (
            <IntentPrefetchLink
              className="ai-product-text-link"
              href={context.programme}
            >
              {block.link}
              <ArrowRight />
            </IntentPrefetchLink>
          )}
        </section>
      );
  }
}

/**
 * Значки и иллюстрации оформление раздаёт по порядку пунктов блока: порядок в описании продукта
 * задаёт и порядок картинок, а лишний пункт получает общий значок без иллюстрации.
 */
function iconAt(icons: readonly LucideIcon[], index: number): LucideIcon {
  return icons[index] ?? Check;
}

const highlightIcons = [Code2, Clock3, MessagesSquare] as const;
function Hero({
  block,
  context,
}: {
  readonly block: ProductPageBlockOf<"hero">;
  readonly context: BlockContext;
}) {
  return (
    <header className="ai-product-hero">
      <div className="ai-product-hero-copy">
        <h1>
          {context.name}
          {block.badge === "" ? null : (
            <>
              {" "}
              <span className="ai-product-badge">{block.badge}</span>
            </>
          )}
        </h1>
        <p className="ai-product-intro">{block.lead}</p>
        {block.highlights.length === 0 ? null : (
          <ul className="ai-product-highlights" aria-label="Формат практикума">
            {block.highlights.map((highlight, index) => {
              const Icon = iconAt(highlightIcons, index);
              return (
                <li key={`${String(index)}-${highlight}`}>
                  <Icon aria-hidden="true" />
                  {highlight}
                </li>
              );
            })}
          </ul>
        )}
        <IntentPrefetchLink
          className="ai-product-button"
          href={context.programme}
        >
          Открыть программу
          <ArrowRight />
        </IntentPrefetchLink>
        {context.freeCount > 0 ? (
          <p className="ai-product-format">
            Бесплатно: {formatMaterialCount(context.freeCount)}
          </p>
        ) : null}
      </div>
      <div className="ai-product-artwork">
        <AiFirstProcessArtwork />
      </div>
    </header>
  );
}

function PlainCards({
  block,
}: {
  readonly block: ProductPageBlockOf<"cards">;
}) {
  return (
    <section className="ai-product-audience">
      {block.eyebrow === "" ? null : (
        <p className="ai-product-eyebrow">{block.eyebrow}</p>
      )}
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-product-section-intro">{block.lead}</p>
      )}
      <dl>
        {block.items.map((item, index) => (
          <div key={`${String(index)}-${item.title}`}>
            <dt>
              <Check />
              {item.title}
            </dt>
            <dd>
              {item.text}
              {item.detail === "" ? null : (
                <span className="ai-product-item-detail">
                  {item.detailLabel === "" ? null : <>{item.detailLabel}: </>}
                  {item.detail}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {block.note === "" ? null : (
        <p className="ai-product-career">{block.note}</p>
      )}
    </section>
  );
}

function TextSection({
  block,
}: {
  readonly block: ProductPageBlockOf<"text">;
}) {
  return (
    <section className="ai-product-shift">
      <h2>{block.title}</h2>
      <div>
        {block.paragraphs.map((paragraph, index) => (
          <p key={`${String(index)}-${paragraph}`}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

const outcomeIcons = [FolderGit2, Workflow, Server] as const;
const proofIcons = [FileCode2, Check, GitPullRequest] as const;
const outcomeVisuals: readonly ReactNode[] = [
  <div
    className="ai-product-result-visual ai-product-result-harness"
    aria-hidden="true"
    key="harness"
  >
    <FolderGit2 />
    <strong>Твой проект</strong>
    <div>
      <span>
        <FileCode2 />
        Инструкции и контекст
      </span>
      <span>
        <FileCode2 />
        Skills и инструменты
      </span>
      <span>
        <FileCode2 />
        Решения и проверки
      </span>
    </div>
  </div>,
  <div
    className="ai-product-result-visual ai-product-result-pipeline"
    aria-hidden="true"
    key="pipeline"
  >
    <Workflow />
    <strong>От задачи до релиза</strong>
    <div>
      {["Исследование и план", "Реализация и ревью", "Проверки и релиз"].map(
        (label) => (
          <span key={label}>
            <Check />
            {label}
          </span>
        ),
      )}
    </div>
  </div>,
  <div
    className="ai-product-result-visual ai-product-result-project"
    aria-hidden="true"
    key="project"
  >
    <Server />
    <strong>Проект в production</strong>
    <div>
      <span>Пользователи и доступ</span>
      <span>Данные и AI-функции</span>
      <span>Деплой и наблюдение</span>
    </div>
  </div>,
];
function OutcomeCards({
  block,
}: {
  readonly block: ProductPageBlockOf<"cards">;
}) {
  return (
    <section className="ai-product-outcomes">
      {block.eyebrow === "" ? null : (
        <p className="ai-product-eyebrow">{block.eyebrow}</p>
      )}
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-product-section-intro ai-product-promise">
          {block.lead}
        </p>
      )}
      <div className="ai-product-outcome-grid">
        {block.items.map((item, index) => {
          const Icon = iconAt(outcomeIcons, index);
          const Proof = iconAt(proofIcons, index);
          return (
            <div key={`${String(index)}-${item.title}`}>
              {outcomeVisuals[index] ?? null}
              <div className="ai-product-result-copy">
                <h3>
                  <Icon aria-hidden="true" />
                  {item.title}
                </h3>
                <p>{item.text}</p>
                {item.detail === "" ? null : (
                  <div className="ai-product-result-proof">
                    <Proof aria-hidden="true" />
                    <span>
                      {item.detailLabel}
                      <strong>{item.detail}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {block.note === "" ? null : (
        <p className="ai-product-career">{block.note}</p>
      )}
    </section>
  );
}

function StepsSection({
  block,
  context,
}: {
  readonly block: ProductPageBlockOf<"steps">;
  readonly context: BlockContext;
}) {
  const titleId = `ai-${block.id}-title`;
  return (
    <section className="ai-product-programme" aria-labelledby={titleId}>
      <h2 id={titleId}>{block.title}</h2>
      {block.lead === "" ? null : <p>{block.lead}</p>}
      <ol>
        {block.items.map((stage, index) => (
          <li key={`${String(index)}-${stage.title}`}>
            <span>{index + 1}</span>
            <div>
              <h3>{stage.title}</h3>
              <p>{stage.text}</p>
            </div>
          </li>
        ))}
      </ol>
      {block.link === "" ? null : (
        <IntentPrefetchLink
          className="ai-product-text-link"
          href={context.programme}
        >
          {block.link}
          <ArrowRight />
        </IntentPrefetchLink>
      )}
    </section>
  );
}

function ListSection({
  block,
}: {
  readonly block: ProductPageBlockOf<"list">;
}) {
  return (
    <section className="ai-product-project">
      <div>
        <h2>{block.title}</h2>
        {block.text === "" ? null : <p>{block.text}</p>}
      </div>
      <div className="ai-product-language-map">
        <ul className="ai-product-languages">
          {block.items.map((language, index) => (
            <li key={`${String(index)}-${language}`}>{language}</li>
          ))}
        </ul>
        <div className="ai-product-language-join" aria-hidden="true" />
        <div className="ai-product-language-project" aria-hidden="true">
          <FolderGit2 />
          <span>
            Твой проект<small>Знакомый стек · новые навыки</small>
          </span>
        </div>
      </div>
    </section>
  );
}

const supportIcons = [MessagesSquare, Play, GitPullRequest] as const;
function SupportCards({
  block,
}: {
  readonly block: ProductPageBlockOf<"cards">;
}) {
  return (
    <section className="ai-product-support" id={`ai-${block.id}`}>
      <div className="ai-product-support-intro">
        {block.eyebrow === "" ? null : (
          <p className="ai-product-eyebrow">{block.eyebrow}</p>
        )}
        <h2>{block.title}</h2>
        {block.lead === "" ? null : <p>{block.lead}</p>}
      </div>
      <div className="ai-product-support-details">
        {block.items.map((item, index) => {
          const Icon = iconAt(supportIcons, index);
          return (
            <div key={`${String(index)}-${item.title}`}>
              <Icon aria-hidden="true" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              {item.detail === "" ? null : (
                <p className="ai-product-item-detail">
                  {item.detailLabel === "" ? null : <>{item.detailLabel}: </>}
                  {item.detail}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {block.note === "" ? null : (
        <p className="ai-product-career">{block.note}</p>
      )}
    </section>
  );
}

const bonusPreviews: readonly ReactNode[] = [
  <div
    className="ai-product-bonus-preview ai-product-bonus-video"
    aria-hidden="true"
    key="video"
  >
    <span>Идея</span>
    <ArrowRight />
    <Play />
    <ArrowRight />
    <span>Ролик</span>
  </div>,
  <div
    className="ai-product-bonus-preview ai-product-bonus-code"
    aria-hidden="true"
    key="code"
  >
    <FolderGit2 />
    <span>
      Код
      <br />
      <small>Решения · примеры · разборы</small>
    </span>
  </div>,
  <div
    className="ai-product-bonus-preview ai-product-bonus-questions"
    aria-hidden="true"
    key="questions"
  >
    <MessagesSquare />
    <span>От вопроса к разбору</span>
  </div>,
];
function BonusCards({
  block,
}: {
  readonly block: ProductPageBlockOf<"cards">;
}) {
  return (
    <section className="ai-product-bonuses">
      {block.eyebrow === "" ? null : (
        <p className="ai-product-eyebrow">{block.eyebrow}</p>
      )}
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-product-section-intro">{block.lead}</p>
      )}
      <div className="ai-product-bonus-grid">
        {block.items.map((item, index) => (
          <div key={`${String(index)}-${item.title}`}>
            {bonusPreviews[index] ?? null}
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            {item.detail === "" ? null : (
              <p className="ai-product-item-detail">
                {item.detailLabel === "" ? null : <>{item.detailLabel}: </>}
                {item.detail}
              </p>
            )}
          </div>
        ))}
      </div>
      {block.note === "" ? null : (
        <p className="ai-product-career">{block.note}</p>
      )}
    </section>
  );
}
