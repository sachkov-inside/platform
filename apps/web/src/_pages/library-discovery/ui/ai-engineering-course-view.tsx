import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  Code2,
  FileCode2,
  FileText,
  FolderGit2,
  Gauge,
  GitBranch,
  GitPullRequest,
  Layers,
  LifeBuoy,
  ListChecks,
  MessagesSquare,
  Play,
  Plug,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import type { ReactNode } from "react";

import type {
  GuidePage,
  GuidePageBlock,
  GuidePageBlockOf,
} from "@/entities/guide-page";
import { ContentCoverImage } from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import {
  ClaudeCodeLogo,
  CodexLogo,
  DeepSeekLogo,
  OpenCodeLogo,
} from "./agent-logos";

import "./ai-first-guide-view.css";
import "./ai-engineering-course-view.css";

type ResolvedSeriesResult = Extract<
  PublishedSeriesResult,
  { kind: "ready" | "empty" }
>;

/**
 * Оформление `ai-engineering-course`: страница-описание курса. Весь текст приходит из описания
 * продукта в Inside Content; оформление берёт композиции разделов страницы AI-first и добавляет к
 * знакомым блокам (по `id`) свои иллюстрации и значки. Блок с другим `id` рисуется по своему виду.
 * Программа и прохождение живут на странице программы: туда ведут все кнопки.
 */
export function AiEngineeringCourseView({
  result,
  page,
  returnTarget,
}: {
  readonly result: ResolvedSeriesResult;
  readonly page: GuidePage;
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  const { reference } = result;
  const programme = guideProgrammeHref(reference.slug);
  const hero = page.blocks.find(
    (block): block is GuidePageBlockOf<"hero"> => block.kind === "hero",
  );
  return (
    <article
      className="ai-guide-page aie-course"
      data-guide-presentation="ai-engineering-course"
      data-guide-product={reference.slug}
    >
      <nav aria-label="Хлебные крошки">
        <IntentPrefetchLink className="ai-guide-back" href={returnTarget.href}>
          <ArrowLeft />
          {returnTarget.label}
        </IntentPrefetchLink>
      </nav>

      <Hero
        block={hero}
        cover={
          <ContentCoverImage
            alt=""
            className="aspect-[3/2] min-h-0 w-full"
            cover={reference.cover ?? null}
            fallbackKind="playlist"
            fallbackSeed={reference.slug}
            priority
          />
        }
        name={reference.name}
        programme={programme}
        summary={reference.summary}
      />

      {page.blocks.map((block) => (
        <CourseBlock block={block} key={block.id} programme={programme} />
      ))}

      <div className="ai-guide-sticky">
        <IntentPrefetchLink className="ai-guide-button" href={programme}>
          Открыть программу
          <ArrowRight />
        </IntentPrefetchLink>
      </div>
    </article>
  );
}

const highlightIcons = [BookOpen, ShieldCheck, MessagesSquare] as const;

/** Значки и иллюстрации идут по порядку пунктов; лишний пункт получает общий значок. */
function iconAt(icons: readonly LucideIcon[], index: number): LucideIcon {
  return icons[index] ?? Check;
}

function Hero({
  block,
  cover,
  name,
  programme,
  summary,
}: {
  readonly block: GuidePageBlockOf<"hero"> | undefined;
  readonly cover: ReactNode;
  readonly name: string;
  readonly programme: Route;
  readonly summary: string;
}) {
  const lead = block?.lead ?? summary;
  return (
    <header className="ai-guide-hero">
      <div className="ai-guide-hero-copy">
        <h1 className="aie-course-title">
          <span className="aie-course-name">{name}</span>
          {block === undefined || block.badge === "" ? null : (
            <>
              {" "}
              <span className="aie-course-badge">{block.badge}</span>
            </>
          )}
        </h1>
        {lead === "" ? null : <p className="ai-guide-intro">{lead}</p>}
        {block === undefined || block.highlights.length === 0 ? null : (
          <ul className="ai-guide-highlights" aria-label="Формат курса">
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
        <IntentPrefetchLink className="ai-guide-button" href={programme}>
          Открыть программу
          <ArrowRight />
        </IntentPrefetchLink>
      </div>
      <div className="aie-course-cover">{cover}</div>
    </header>
  );
}

function CourseBlock({
  block,
  programme,
}: {
  readonly block: GuidePageBlock;
  readonly programme: Route;
}): ReactNode {
  switch (block.kind) {
    case "hero":
      return null;
    case "cards":
      if (block.id === "topics") return <TopicGrid block={block} />;
      if (block.id === "audience") return <Audience block={block} />;
      return <ChecklistCards block={block} />;
    case "text":
      if (block.id === "mentoring") return <Mentoring block={block} />;
      if (block.id === "practice") return <Practice block={block} />;
      return <SplitText block={block} />;
    case "steps":
      return <FormatCards block={block} programme={programme} />;
    case "list":
      if (block.id === "status")
        return <Status block={block} programme={programme} />;
      if (block.id === "agents") return <Agents block={block} />;
      return <Status block={block} programme={programme} />;
    // Бесплатных уроков у анонса нет, а сроки оферты он не называет: приглашение не показываем.
    case "trial":
      return null;
  }
}

const mentorPoints = [
  { icon: MessagesSquare, label: "Вопросы автору по материалам и практике" },
  { icon: LifeBuoy, label: "Помощь с проблемами в твоём проекте" },
  { icon: RefreshCw, label: "Курс обновляется вместе с технологиями" },
] as const;
function Mentoring({ block }: { readonly block: GuidePageBlockOf<"text"> }) {
  return (
    <section className="ai-guide-support aie-mentoring">
      <div className="ai-guide-support-intro">
        <h2>{block.title}</h2>
        {block.paragraphs.map((paragraph, index) => (
          <p key={`${String(index)}-${paragraph}`}>{paragraph}</p>
        ))}
      </div>
      <ul className="aie-mentoring-points" aria-hidden="true">
        {mentorPoints.map(({ icon: Icon, label }) => (
          <li key={label}>
            <Icon />
            <span>{label}</span>
          </li>
        ))}
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
        {["Требования", "Задачи", "Код", "Pull request"].map((step, index) => (
          <span key={step}>
            {index === 3 ? <GitPullRequest /> : <Check />}
            {step}
          </span>
        ))}
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
        <span>
          <FileText />
        </span>
        <i />
        <span>
          <Code2 />
        </span>
        <i />
        <span>
          <ShieldCheck />
        </span>
        <i />
        <span>
          <Rocket />
        </span>
      </div>
    ),
  },
  {
    size: "wide",
    tone: "coral",
    art: (
      <div className="aie-art-agent">
        <span className="aie-art-agent-core">
          <Bot />
          Агент
        </span>
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
      </div>
    ),
  },
  {
    size: "wide",
    tone: "sand",
    art: (
      <div className="aie-art-guard">
        <span className="aie-art-guard-action">
          <Terminal />
          git push --force
        </span>
        <span className="aie-art-guard-gate">
          <ShieldCheck />
          Нужно подтверждение
        </span>
        <span className="aie-art-guard-buttons">
          <b>Разрешить</b>
          <b>Отклонить</b>
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
];
const topicIcons = [
  Workflow,
  FolderGit2,
  Layers,
  GitBranch,
  Bot,
  Search,
  ShieldCheck,
  Gauge,
] as const;
function TopicGrid({ block }: { readonly block: GuidePageBlockOf<"cards"> }) {
  return (
    <section className="ai-guide-outcomes aie-topics">
      {block.eyebrow === "" ? null : (
        <p className="ai-guide-eyebrow">{block.eyebrow}</p>
      )}
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-guide-section-intro ai-guide-promise">{block.lead}</p>
      )}
      <ul className="aie-bento">
        {block.items.map((item, index) => {
          const tile = topicTiles[index];
          const Icon = iconAt(topicIcons, index);
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
                <h3>
                  <Icon aria-hidden="true" />
                  {item.title}
                </h3>
                <p>{item.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {block.note === "" ? null : (
        <p className="ai-guide-career">{block.note}</p>
      )}
    </section>
  );
}

function ChecklistCards({
  block,
}: {
  readonly block: GuidePageBlockOf<"cards">;
}) {
  return (
    <section className="ai-guide-audience">
      {block.eyebrow === "" ? null : (
        <p className="ai-guide-eyebrow">{block.eyebrow}</p>
      )}
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-guide-section-intro">{block.lead}</p>
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
                <span className="ai-guide-item-detail">
                  {item.detailLabel === "" ? null : <>{item.detailLabel}: </>}
                  {item.detail}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {block.note === "" ? null : (
        <p className="ai-guide-career">{block.note}</p>
      )}
    </section>
  );
}

function SplitText({ block }: { readonly block: GuidePageBlockOf<"text"> }) {
  return (
    <section className="ai-guide-shift">
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
  readonly block: GuidePageBlockOf<"steps">;
  readonly programme: Route;
}) {
  const titleId = `aie-${block.id}-title`;
  return (
    <section className="aie-format" aria-labelledby={titleId}>
      <h2 id={titleId}>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-guide-section-intro">{block.lead}</p>
      )}
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
      {block.link === "" ? null : (
        <IntentPrefetchLink className="ai-guide-text-link" href={programme}>
          {block.link}
          <ArrowRight />
        </IntentPrefetchLink>
      )}
    </section>
  );
}

/** Практика: короткий текст и стопка задач, которые проходит участник. */
const practiceTasks = [
  { label: "Первая фича вместе с агентом", state: "done" },
  { label: "MCP-сервер для своего агента", state: "done" },
  { label: "Агент с поиском по документации", state: "current" },
  { label: "Evals и выпуск изменений", state: "next" },
] as const;
function Practice({ block }: { readonly block: GuidePageBlockOf<"text"> }) {
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
  };
/** Агенты с логотипами; незнакомое название получает нейтральный знак. */
function Agents({ block }: { readonly block: GuidePageBlockOf<"list"> }) {
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

const audienceIcons = [Code2, Sparkles, ListChecks] as const;
/** Для кого: три равные карточки со значками, заметка отдельной строкой. */
function Audience({ block }: { readonly block: GuidePageBlockOf<"cards"> }) {
  return (
    <section className="aie-audience">
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-guide-section-intro">{block.lead}</p>
      )}
      <ul>
        {block.items.map((item, index) => {
          const Icon = iconAt(audienceIcons, index);
          return (
            <li key={`${String(index)}-${item.title}`}>
              <Icon aria-hidden="true" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
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

function Status({
  block,
  programme,
}: {
  readonly block: GuidePageBlockOf<"list">;
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
