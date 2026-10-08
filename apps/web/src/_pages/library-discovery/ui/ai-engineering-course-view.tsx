import {
  ArrowRight,
  ChevronLeft,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Coins,
  FileCode2,
  FileText,
  FolderGit2,
  Gauge,
  Layers,
  MessagesSquare,
  Play,
  Plug,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import type { Route } from "next";
import type { CSSProperties, ReactNode } from "react";

import type {
  ProductPage,
  ProductPageBlock,
  ProductPageBlockOf,
} from "@/entities/product-page";
import {
  CourseHero,
  CourseIcon,
  type CourseIconName,
} from "@/features/ai-engineering-course";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import {
  ClaudeCodeLogo,
  CodexLogo,
  DeepSeekLogo,
  HermesAgentLogo,
  OpenCodeLogo,
} from "./agent-logos";

import { countFreeLessons } from "../model/free-lessons";
import "./ai-first-product-view.css";
import "./ai-engineering-course-view.css";

type ResolvedSeriesResult = Extract<
  PublishedSeriesResult,
  { kind: "ready" | "empty" }
>;

/**
 * Оформление `ai-engineering-course`: страница-описание курса. Весь текст приходит из описания
 * продукта в Inside Content; оформление берёт композиции разделов страницы AI-first и добавляет к
 * знакомым блокам (по `id`) свои иллюстрации и значки. Блок с другим `id` рисуется по своему виду.
 * Программа и прохождение живут на странице программы: туда ведут все кнопки. На телефоне и
 * планшете навигации сайта внизу нет: её место занимает кнопка в программу, а назад ведёт
 * маленькая кнопка в самом верху.
 */
export function AiEngineeringCourseView({
  heroCall,
  result,
  page,
  returnTarget,
}: {
  /** Плашка потока и кнопка по этапу продаж; без неё первый экран ведёт в программу. */
  readonly heroCall?: ReactNode;
  readonly result: ResolvedSeriesResult;
  readonly page: ProductPage;
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  const { reference } = result;
  const programme = productProgrammeHref(reference.slug);
  const hasFreeLessons =
    countFreeLessons(result.kind === "ready" ? result.items : []) > 0;
  const hero = page.blocks.find(
    (block): block is ProductPageBlockOf<"hero"> => block.kind === "hero",
  );
  return (
    <article
      className="ai-product-page aie-course"
      data-product-presentation="ai-engineering-course"
      data-hide-mobile-navigation
      data-product-landing={reference.slug}
    >
      <IntentPrefetchLink className="aie-back" href={returnTarget.href}>
        <ChevronLeft aria-hidden="true" />
        Назад
      </IntentPrefetchLink>

      <header className="aie-course-hero">
        <CourseHero
          action={{ href: programme, label: "Открыть программу" }}
          badge={hero?.badge ?? ""}
          call={heroCall}
          compactActionOnPhone
          highlights={hero?.highlights ?? []}
          lead={hero?.lead ?? reference.summary}
          name={reference.name}
        />
      </header>

      {page.blocks.map((block) => (
        <CourseBlock
          block={block}
          hasFreeLessons={hasFreeLessons}
          key={block.id}
          programme={programme}
        />
      ))}

      <div className="ai-product-sticky">
        <IntentPrefetchLink className="ai-product-button" href={programme}>
          Открыть программу
          <ArrowRight />
        </IntentPrefetchLink>
      </div>
    </article>
  );
}

function CourseBlock({
  block,
  hasFreeLessons,
  programme,
}: {
  readonly block: ProductPageBlock;
  readonly hasFreeLessons: boolean;
  readonly programme: Route;
}): ReactNode {
  switch (block.kind) {
    case "hero":
      return null;
    case "cards":
      if (block.id === "topics") return <TopicGrid block={block} />;
      if (block.id === "audience") return <Audience block={block} />;
      if (block.id === "value") return <ValueGrid block={block} />;
      if (block.id === "faq") return <Faq block={block} />;
      if (block.id === "mentoring") return <Mentoring block={block} />;
      return <ChecklistCards block={block} />;
    case "text":
      if (block.id === "practice") return <Practice block={block} />;
      return <SplitText block={block} />;
    case "steps":
      return <FormatCards block={block} programme={programme} />;
    case "list":
      if (block.id === "status")
        return <Status block={block} programme={programme} />;
      if (block.id === "agents") return <Agents block={block} />;
      return <Status block={block} programme={programme} />;
    // Приглашение к бесплатным урокам имеет смысл, только пока такие уроки есть (ADR 0026).
    case "trial":
      return hasFreeLessons ? (
        <section className="ai-product-trial">
          <h2>{block.title}</h2>
          <p>{block.text}</p>
          {block.link === "" ? null : (
            <IntentPrefetchLink
              className="ai-product-text-link"
              href={programme}
            >
              {block.link}
              <ArrowRight />
            </IntentPrefetchLink>
          )}
        </section>
      ) : null;
  }
}

type CardItem = ProductPageBlockOf<"cards">["items"][number];

/**
 * Необязательные поля карточек: оформление курса рисует их у каждого блока, чтобы написанное в
 * описании продукта не пропадало (ADR 0026).
 */
function Eyebrow({ text }: { readonly text: string }) {
  return text === "" ? null : <p className="ai-product-eyebrow">{text}</p>;
}
function ItemDetail({ item }: { readonly item: CardItem }) {
  return item.detail === "" ? null : (
    <span className="ai-product-item-detail">
      {item.detailLabel === "" ? null : <>{item.detailLabel}: </>}
      {item.detail}
    </span>
  );
}
function Note({ text }: { readonly text: string }) {
  return text === "" ? null : <p className="ai-product-career">{text}</p>;
}

const mentoringIcons: readonly CourseIconName[] = [
  "questions",
  "help",
  "updates",
];
/** Менторинг: вводный текст слева, пункты из описания курса лесенкой справа. */
function Mentoring({ block }: { readonly block: ProductPageBlockOf<"cards"> }) {
  return (
    <section className="ai-product-support aie-mentoring">
      <div className="ai-product-support-intro">
        <Eyebrow text={block.eyebrow} />
        <h2>{block.title}</h2>
        {block.lead === "" ? null : <p>{block.lead}</p>}
        <Note text={block.note} />
      </div>
      <ul className="aie-mentoring-points">
        {block.items.map((item, index) => {
          return (
            <li key={`${String(index)}-${item.title}`}>
              <CourseIcon name={mentoringIcons[index] ?? "questions"} />
              <span>
                <b>{item.title}</b>
                {item.text}
                <ItemDetail item={item} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Мини-иллюстрации тем по порядку пунктов блока `topics`. Это знаки темы, а не данные: подписи
 * внутри короткие и повторяют смысл плитки. Размер плитки задаёт ритм bento-сетки.
 */
const topicTiles: readonly {
  readonly size: "wide" | "narrow";
  readonly tone: string;
  readonly art: ReactNode;
}[] = [
  {
    size: "wide",
    tone: "ink",
    art: (
      <div className="aie-art-flow">
        <div className="aie-art-flow-steps">
          {["Задача", "План", "Код", "Проверка"].map((step, index) => (
            <span key={step}>
              {index === 3 ? <ShieldCheck /> : <Check />}
              {step}
            </span>
          ))}
        </div>
        <div className="aie-art-flow-roles">
          <span>
            <UserRound />
            Ты контролируешь
          </span>
          <span>
            <Bot />
            Агент выполняет
          </span>
        </div>
      </div>
    ),
  },
  {
    size: "narrow",
    tone: "example",
    art: (
      <div className="aie-art-tree">
        <span>
          <FolderGit2 />
          repo
        </span>
        <span>
          <FileCode2 />
          AGENTS.md
        </span>
        <span>
          <FileCode2 />
          skills/
        </span>
        <span>
          <FileCode2 />
          checks/
        </span>
      </div>
    ),
  },
  {
    size: "narrow",
    tone: "sand",
    art: (
      <div className="aie-art-stack">
        <span>Задача</span>
        <span>Решения</span>
        <span>Код модуля</span>
        <span data-muted="true">Лишнее</span>
      </div>
    ),
  },
  {
    size: "narrow",
    tone: "good",
    art: (
      <div className="aie-art-pipeline">
        {(
          [
            [FileText, "Спецификация"],
            [Code2, "Реализация"],
            [ShieldCheck, "Проверки"],
            [Rocket, "Релиз"],
          ] as const
        ).map(([StepIcon, label]) => (
          <span key={label}>
            <StepIcon />
            {label}
          </span>
        ))}
      </div>
    ),
  },
  {
    size: "wide",
    tone: "coral",
    art: (
      <div className="aie-art-agent">
        <span className="aie-art-agent-end">
          <FileText />
          Задача
        </span>
        <ArrowRight className="aie-art-agent-arrow" />
        <span className="aie-art-agent-core">
          <Bot />
          Агент
        </span>
        <ArrowRight className="aie-art-agent-arrow" />
        <span className="aie-art-agent-end">
          <Check />
          Результат
        </span>
        <div className="aie-art-agent-tools">
          <span>
            <Sparkles />
            Модель
          </span>
          <span>
            <Wrench />
            Инструменты
          </span>
          <span>
            <Plug />
            MCP
          </span>
        </div>
      </div>
    ),
  },
  {
    size: "narrow",
    tone: "blue",
    art: (
      <div className="aie-art-rag">
        <span className="aie-art-rag-query">
          <Search />
          Как устроен вход?
        </span>
        <span>
          <FileText />
          auth.md
        </span>
        <span>
          <FileText />
          adr-012.md
        </span>
        <span className="aie-art-rag-answer">
          <MessagesSquare />
          Ответ со ссылками [1] [2]
        </span>
      </div>
    ),
  },
  {
    size: "wide",
    tone: "sand",
    art: (
      <div className="aie-art-guard">
        <span className="aie-art-guard-action">
          <Bot />
          Шаг 3 из 5 · auth.ts
        </span>
        <span className="aie-art-guard-gate">
          <ShieldCheck />
          Тесты 24/24
        </span>
        <span className="aie-art-guard-buttons">
          <b>Дифф проверен</b>
          <b>Принять</b>
        </span>
      </div>
    ),
  },
  {
    size: "wide",
    tone: "lavender",
    art: (
      <div className="aie-art-evals" aria-label="">
        {[42, 58, 51, 74, 69, 86].map((value, index) => (
          <i
            data-after={index >= 3}
            key={`${String(index)}-${String(value)}`}
            style={{ blockSize: `${String(value)}%` }}
          />
        ))}
        <span>
          <Gauge />
          было → стало
        </span>
      </div>
    ),
  },
  {
    size: "wide",
    tone: "good",
    art: (
      <div className="aie-art-process">
        {["Разбор обращений", "Ревью изменений", "Подготовка релиза"].map(
          (label) => (
            <div key={label}>
              <span>
                <Bot />
                {label}
              </span>
              <ArrowRight />
              <span className="aie-art-process-human">
                <UserRound />
                Проверка
              </span>
            </div>
          ),
        )}
      </div>
    ),
  },
  {
    size: "wide",
    tone: "blue",
    art: (
      <div className="aie-art-tokens">
        <div className="aie-art-tokens-meter">
          <span>
            <Layers />
            Контекст
          </span>
          <i>
            <b />
          </i>
          <small>18k из 200k</small>
        </div>
        <div className="aie-art-tokens-chips">
          <span>
            <Sparkles />
            Модель под задачу
          </span>
          <span>
            <Coins />
            $0.04 за задачу
          </span>
        </div>
      </div>
    ),
  },
];
function TopicGrid({ block }: { readonly block: ProductPageBlockOf<"cards"> }) {
  return (
    <section className="ai-product-outcomes aie-topics">
      <Eyebrow text={block.eyebrow} />
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-product-section-intro ai-product-promise">
          {block.lead}
        </p>
      )}
      <ul className="aie-bento">
        {block.items.map((item, index) => {
          const tile = topicTiles[index];
          return (
            <li
              data-size={tile?.size ?? "narrow"}
              data-tone={tile?.tone ?? "sand"}
              key={`${String(index)}-${item.title}`}
            >
              {tile === undefined ? null : (
                <div aria-hidden="true" className="aie-bento-art">
                  {tile.art}
                </div>
              )}
              <div className="aie-bento-copy">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <ItemDetail item={item} />
              </div>
            </li>
          );
        })}
      </ul>
      <Note text={block.note} />
    </section>
  );
}

function ChecklistCards({
  block,
}: {
  readonly block: ProductPageBlockOf<"cards">;
}) {
  return (
    <section className="ai-product-audience">
      <Eyebrow text={block.eyebrow} />
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
              <ItemDetail item={item} />
            </dd>
          </div>
        ))}
      </dl>
      <Note text={block.note} />
    </section>
  );
}

function SplitText({ block }: { readonly block: ProductPageBlockOf<"text"> }) {
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

/** Витрины формата по порядку пунктов: страница гайда, плеер, терминал с проверками, диалог. */
const formatArt: readonly ReactNode[] = [
  <div className="aie-mock-doc" key="doc">
    <b />
    <i />
    <i />
    <span>
      <FileText />
      <ArrowRight />
      <Code2 />
    </span>
    <i />
  </div>,
  <div className="aie-mock-video" key="video">
    <span>
      <Play />
    </span>
    <i>
      <b />
    </i>
  </div>,
  <div className="aie-mock-terminal" key="terminal">
    <code>$ pnpm test</code>
    <code data-ok="true">✓ 24 passed</code>
    <code data-ok="true">✓ проверка пройдена</code>
  </div>,
  <div className="aie-mock-chat" key="chat">
    <span>Проверка не проходит, куда смотреть?</span>
    <span data-author="true">Давай разберём вместе</span>
  </div>,
];
function FormatCards({
  block,
  programme,
}: {
  readonly block: ProductPageBlockOf<"steps">;
  readonly programme: Route;
}) {
  const titleId = `aie-${block.id}-title`;
  return (
    <section className="aie-format" aria-labelledby={titleId}>
      <div className="aie-format-head">
        <div>
          <h2 id={titleId}>{block.title}</h2>
          {block.lead === "" ? null : (
            <p className="ai-product-section-intro">{block.lead}</p>
          )}
        </div>
        {block.link === "" ? null : (
          <IntentPrefetchLink className="ai-product-text-link" href={programme}>
            {block.link}
            <ArrowRight />
          </IntentPrefetchLink>
        )}
      </div>
      <ol>
        {block.items.map((step, index) => (
          <li key={`${String(index)}-${step.title}`}>
            <div aria-hidden="true" className="aie-format-art">
              {formatArt[index] ?? null}
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Практика: короткий текст и стопка задач, которые проходит участник. */
const practiceTasks = [
  { label: "Первая фича вместе с агентом", state: "done" },
  { label: "MCP-сервер для своего агента", state: "done" },
  { label: "Агент с поиском по документам проекта", state: "current" },
  { label: "Evals и проверка перед релизом", state: "next" },
] as const;
function Practice({ block }: { readonly block: ProductPageBlockOf<"text"> }) {
  return (
    <section className="aie-practice">
      <div>
        <h2>{block.title}</h2>
        {block.paragraphs.map((paragraph, index) => (
          <p key={`${String(index)}-${paragraph}`}>{paragraph}</p>
        ))}
      </div>
      <ul aria-hidden="true" className="aie-practice-tasks">
        {practiceTasks.map(({ label, state }) => (
          <li data-state={state} key={label}>
            <span>
              {state === "done" ? (
                <Check />
              ) : state === "current" ? (
                <Play />
              ) : null}
            </span>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

const agentLogos: Record<string, (props: { className?: string }) => ReactNode> =
  {
    "claude code": ClaudeCodeLogo,
    codex: CodexLogo,
    opencode: OpenCodeLogo,
    deepseek: DeepSeekLogo,
    hermes: HermesAgentLogo,
  };
/** Агенты с логотипами; незнакомое название получает нейтральный знак. */
function Agents({ block }: { readonly block: ProductPageBlockOf<"list"> }) {
  return (
    <section className="aie-agents">
      <div className="aie-agents-copy">
        <h2>{block.title}</h2>
        {block.text === "" ? null : <p>{block.text}</p>}
      </div>
      <ul>
        {block.items.map((item, index) => {
          const Logo = agentLogos[item.toLowerCase()];
          return (
            <li key={`${String(index)}-${item}`}>
              {Logo === undefined ? (
                <Sparkles aria-hidden="true" className="aie-agent-mark" />
              ) : (
                <Logo className="aie-agent-mark" />
              )}
              <span>{item}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const audienceIcons: readonly CourseIconName[] = [
  "developer",
  "engineer",
  "basics",
];
/** Для кого: три равные карточки со значками, заметка отдельной строкой. */
function Audience({ block }: { readonly block: ProductPageBlockOf<"cards"> }) {
  return (
    <section className="aie-audience">
      <Eyebrow text={block.eyebrow} />
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-product-section-intro">{block.lead}</p>
      )}
      <ul>
        {block.items.map((item, index) => {
          return (
            <li key={`${String(index)}-${item.title}`}>
              <CourseIcon name={audienceIcons[index] ?? "developer"} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <ItemDetail item={item} />
            </li>
          );
        })}
      </ul>
      {block.note === "" ? null : (
        <p className="aie-audience-note">
          <Check aria-hidden="true" />
          {block.note}
        </p>
      )}
    </section>
  );
}

type CssVariables = CSSProperties & Record<`--${string}`, number | string>;
/** CSS-переменные блока: номер пункта задаёт высоту столбика, остальное делает таблица стилей. */
function cssVariables(values: Record<`--${string}`, number>): CssVariables {
  return values;
}

/**
 * Что даёт курс: польза растёт от первой к последней. На широком экране над текстом растут
 * столбики с номерами, текст стоит на одной линии; на планшете и телефоне это вертикальный путь.
 */
function ValueGrid({ block }: { readonly block: ProductPageBlockOf<"cards"> }) {
  return (
    <section className="aie-value">
      <div className="aie-value-head">
        <Eyebrow text={block.eyebrow} />
        <h2>{block.title}</h2>
        {block.lead === "" ? null : <p>{block.lead}</p>}
      </div>
      <ol style={cssVariables({ "--aie-steps": block.items.length })}>
        {block.items.map((item, index) => {
          const number = String(index + 1).padStart(2, "0");
          return (
            <li
              key={`${String(index)}-${item.title}`}
              style={cssVariables({ "--aie-step": index })}
            >
              <span aria-hidden="true" className="aie-value-rise">
                <b>{number}</b>
              </span>
              <span aria-hidden="true" className="aie-value-number">
                {number}
              </span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <ItemDetail item={item} />
            </li>
          );
        })}
      </ol>
      <Note text={block.note} />
    </section>
  );
}

/** Частые вопросы: вопрос раскрывает ответ; нативный `details` работает с клавиатуры и без скриптов. */
function Faq({ block }: { readonly block: ProductPageBlockOf<"cards"> }) {
  return (
    <section className="aie-faq">
      <div className="aie-faq-head">
        <Eyebrow text={block.eyebrow} />
        <h2>{block.title}</h2>
        {block.lead === "" ? null : (
          <p className="ai-product-section-intro">{block.lead}</p>
        )}
      </div>
      <div className="aie-faq-list">
        {block.items.map((item, index) => (
          <details key={`${String(index)}-${item.title}`}>
            <summary>
              <span>{item.title}</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <p>
              {item.text}
              <ItemDetail item={item} />
            </p>
          </details>
        ))}
      </div>
      {block.note === "" ? null : (
        <p className="aie-faq-note">
          <CourseIcon name="telegram" />
          <span>{withTelegramLinks(block.note)}</span>
        </p>
      )}
    </section>
  );
}

/**
 * Ник Telegram в тексте автора становится ссылкой: контакт хранится в описании курса, а не в коде.
 * Правило Telegram: 5–32 символа, латиница, цифры и подчёркивание.
 */
function withTelegramLinks(text: string): ReactNode[] {
  return text.split(/(@[A-Za-z][A-Za-z0-9_]{4,31})/u).map((part, index) =>
    index % 2 === 1 ? (
      <a
        href={`https://t.me/${part.slice(1)}`}
        key={`${String(index)}-${part}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function Status({
  block,
  programme,
}: {
  readonly block: ProductPageBlockOf<"list">;
  readonly programme: Route;
}) {
  return (
    <section className="aie-status">
      <div>
        <h2>{block.title}</h2>
        {block.text === "" ? null : <p>{block.text}</p>}
      </div>
      <ul>
        {block.items.map((item, index) => (
          <li key={`${String(index)}-${item}`}>
            <Check aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
      <IntentPrefetchLink className="aie-status-button" href={programme}>
        Открыть программу
        <ArrowRight />
      </IntentPrefetchLink>
    </section>
  );
}
