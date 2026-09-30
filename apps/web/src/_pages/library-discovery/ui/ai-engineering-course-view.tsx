import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  FileCode2,
  FileSearch,
  FolderGit2,
  Gauge,
  LifeBuoy,
  MessagesSquare,
  RefreshCw,
  Server,
  ShieldCheck,
  Workflow,
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
        <h1>
          {name}
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
      if (block.id === "outcomes") return <OutcomeCards block={block} />;
      return <ChecklistCards block={block} />;
    case "text":
      if (block.id === "mentoring") return <Mentoring block={block} />;
      return <SplitText block={block} />;
    case "steps":
      return <NumberedSteps block={block} programme={programme} />;
    case "list":
      if (block.id === "status")
        return <Status block={block} programme={programme} />;
      return <Converging block={block} />;
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

const outcomeIcons = [Workflow, FolderGit2, Server, Bot, Gauge] as const;
/** Мини-иллюстрации результатов: они повторяют смысл карточки, а текст остаётся в карточке. */
const outcomeVisuals: readonly {
  readonly tone: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly rowIcon?: LucideIcon;
  readonly rows: readonly string[];
}[] = [
  {
    tone: "ink",
    icon: Workflow,
    title: "Цикл задачи",
    rowIcon: Check,
    rows: ["Спецификация", "Задачи", "Реализация", "Проверка и PR"],
  },
  {
    tone: "example",
    icon: FolderGit2,
    title: "Твой репозиторий",
    rowIcon: FileCode2,
    rows: ["AGENTS.md", "skills/", "checks/"],
  },
  {
    tone: "good",
    icon: Server,
    title: "Платформа команды",
    rows: ["Проекты и участники", "Вход и права", "GitHub · MCP"],
  },
  {
    tone: "coral",
    icon: Bot,
    title: "Помощник в чате",
    rowIcon: FileSearch,
    rows: ["Вопрос сотрудника", "Найденные документы", "Ответ со ссылками"],
  },
  {
    tone: "lavender",
    icon: Gauge,
    title: "Качество и релиз",
    rows: ["Evals: было → стало", "Метрики и журналы", "Восстановление"],
  },
];
function OutcomeCards({ block }: { readonly block: GuidePageBlockOf<"cards"> }) {
  return (
    <section className="ai-guide-outcomes">
      {block.eyebrow === "" ? null : (
        <p className="ai-guide-eyebrow">{block.eyebrow}</p>
      )}
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-guide-section-intro ai-guide-promise">{block.lead}</p>
      )}
      <div className="ai-guide-outcome-grid aie-outcome-grid">
        {block.items.map((item, index) => {
          const Icon = iconAt(outcomeIcons, index);
          const visual = outcomeVisuals[index];
          return (
            <div key={`${String(index)}-${item.title}`}>
              {visual === undefined ? null : (
                <div
                  aria-hidden="true"
                  className="ai-guide-result-visual aie-result-visual"
                  data-tone={visual.tone}
                >
                  <visual.icon />
                  <strong>{visual.title}</strong>
                  <div>
                    {visual.rows.map((row) => (
                      <span key={row}>
                        {visual.rowIcon === undefined ? null : (
                          <visual.rowIcon />
                        )}
                        {row}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="ai-guide-result-copy">
                <h3>
                  <Icon aria-hidden="true" />
                  {item.title}
                </h3>
                <p>{item.text}</p>
                {item.detail === "" ? null : (
                  <div className="ai-guide-result-proof">
                    <Check aria-hidden="true" />
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

function NumberedSteps({
  block,
  programme,
}: {
  readonly block: GuidePageBlockOf<"steps">;
  readonly programme: Route;
}) {
  const titleId = `aie-${block.id}-title`;
  return (
    <section className="ai-guide-programme" aria-labelledby={titleId}>
      <h2 id={titleId}>{block.title}</h2>
      {block.lead === "" ? null : <p>{block.lead}</p>}
      <ol>
        {block.items.map((step, index) => (
          <li key={`${String(index)}-${step.title}`}>
            <span>{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
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

/** Короткие пункты сходятся к проекту участника: любой из них ведёт к одному результату. */
function Converging({ block }: { readonly block: GuidePageBlockOf<"list"> }) {
  return (
    <section className="ai-guide-project">
      <div>
        <h2>{block.title}</h2>
        {block.text === "" ? null : <p>{block.text}</p>}
      </div>
      <div className="ai-guide-language-map">
        <ul className="ai-guide-languages">
          {block.items.map((item, index) => (
            <li key={`${String(index)}-${item}`}>{item}</li>
          ))}
        </ul>
        <div className="ai-guide-language-join" aria-hidden="true" />
        <div className="ai-guide-language-project" aria-hidden="true">
          <FolderGit2 />
          <span>
            Твой harness<small>Любой агент · один подход</small>
          </span>
        </div>
      </div>
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
