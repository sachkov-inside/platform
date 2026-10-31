import {
  Activity,
  ArrowRight,
  Ban,
  BookOpen,
  Boxes,
  Database,
  Lock,
  Bot,
  Check,
  ChevronDown,
  Code2,
  FileCode2,
  FileText,
  FolderGit2,
  GitPullRequest,
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
import type { PublishedProductResult } from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";

import {
  ClaudeCodeLogo,
  CodexLogo,
  DeepSeekLogo,
  HermesAgentLogo,
  OpenCodeLogo,
} from "./agent-logos";

import { cohortEnrollAnchor } from "../model/cohort-call";
import { countFreeLessons } from "../model/free-lessons";
import "./ai-first-product-view.css";
import "./ai-engineering-course-view.css";
import "./ai-engineering-landing-v2.prototype.css";
import { ArtifactWindow } from "./ai-engineering-landing-v2-artifacts.prototype.client";

type ResolvedProductResult = Extract<
  PublishedProductResult,
  { kind: "ready" | "empty" }
>;

/**
 * PROTOTYPE, prototype/ai-engineering-landing-v2: копия `ai-engineering-course-view.tsx` с новыми
 * разделами «Моя позиция», «Метод курса», «Как это выглядит внутри» и двумя слоями «Что изучим».
 * В production не импортируется.
 *
 * Оформление `ai-engineering-course`: страница-описание курса. Весь текст приходит из описания
 * продукта в Inside Content; оформление берёт композиции разделов страницы AI-first и добавляет к
 * знакомым блокам (по `id`) свои иллюстрации и значки. Блок с другим `id` рисуется по своему виду.
 * Главы и прохождение живут на странице программы. На телефоне и
 * планшете навигации сайта внизу нет: её место занимает кнопка в программу, а назад ведёт
 * маленькая кнопка в самом верху.
 */
export function AiEngineeringLandingV2Prototype({
  heroCall,
  result,
  page,
  returnTarget,
  statusCall,
  heroBadge,
}: {
  /** Плашка потока и кнопка по этапу продаж; без неё первый экран ведёт в программу. */
  readonly heroCall?: ReactNode;
  readonly result: ResolvedProductResult;
  readonly page: ProductPage;
  readonly returnTarget: MaterialReaderReturnTarget;
  /** Плашка набора вместо вступления нижнего блока или метка участника, убирающая блок. */
  readonly statusCall?: ReactNode;
  /** Действие обучения на анимации или наклейка «до старта N дней». */
  readonly heroBadge?: ReactNode;
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
      data-product-landing={reference.slug}
    >
      <HideMobileNavigation />
      <div data-product-part="back">
        <CatalogBackLink href={returnTarget.href} label={returnTarget.label} />
      </div>

      <header className="aie-course-hero" data-product-part="hero">
        <CourseHero
          badge={hero?.badge ?? ""}
          call={heroCall}
          filmBadge={heroBadge}
          highlights={hero?.highlights ?? []}
          lead={hero?.lead ?? reference.summary}
          name={reference.name}
        />
      </header>

      {page.blocks
        .filter((block) => block.id !== "programme-practice")
        .map((block) => (
          <CourseBlock
            key={block.id}
            statusCall={statusCall}
            block={block}
            hasFreeLessons={hasFreeLessons}
            programme={programme}
          />
        ))}
    </article>
  );
}

function CourseBlock({
  block,
  hasFreeLessons,
  programme,
  statusCall,
}: {
  readonly block: ProductPageBlock;
  readonly hasFreeLessons: boolean;
  readonly programme: Route;
  readonly statusCall?: ReactNode;
}): ReactNode {
  switch (block.kind) {
    case "hero":
      return null;
    case "cards":
      if (block.id === "topics")
        return <TopicGrid block={block} programme={programme} />;
      if (block.id === "audience") return <Audience block={block} />;
      if (block.id === "value") return <ValueGrid block={block} />;
      if (block.id === "faq") return <Faq block={block} />;
      if (block.id === "mentoring") return <Mentoring block={block} />;
      if (block.id === "position") return <Position block={block} />;
      return <ChecklistCards block={block} />;
    case "text":
      if (block.id === "practice") return <Practice block={block} />;
      if (block.id === "artifacts") return <Artifacts block={block} />;
      return <SplitText block={block} />;
    case "steps":
      return <FormatCards block={block} programme={programme} />;
    case "list":
      if (block.id === "status")
        return <Status block={block} call={statusCall} programme={programme} />;
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
 * Иллюстрации тем `topics` по названию темы, а не по порядку: автор может переставить темы, и
 * картинка не уедет к чужой плитке. Это знаки темы, а не данные. Размер плитки задаёт ритм сетки.
 */
const topicTiles: Readonly<
  Record<
    string,
    {
      readonly size: "wide" | "narrow";
      readonly tone: string;
      readonly art: ReactNode;
    }
  >
> = {
  "Инженерная работа": {
    size: "wide",
    tone: "ink",
    art: (
      <div className="aie-art-engineering">
        <span className="aie-art-engineering-question">
          <Search /> Что нужно решить?
        </span>
        <div className="aie-art-engineering-decisions">
          <span>
            <Layers /> Архитектура
          </span>
          <span>
            <GitPullRequest /> Компромиссы
          </span>
        </div>
        <div className="aie-art-engineering-result">
          <ShieldCheck /> Понятная и поддерживаемая система
        </div>
      </div>
    ),
  },
  "Домен и бизнес-логика": {
    size: "narrow",
    tone: "lavender",
    art: (
      <div className="aie2-art-domain">
        <span>
          <BookOpen /> Словарь домена
        </span>
        <dl>
          <div>
            <dt>Обращение</dt>
            <dd>вопрос клиента</dd>
          </div>
          <div>
            <dt>Черновик</dt>
            <dd>ответ агента</dd>
          </div>
          <div>
            <dt>Эскалация</dt>
            <dd>к оператору</dd>
          </div>
        </dl>
      </div>
    ),
  },
  Модульность: {
    size: "narrow",
    tone: "good",
    art: (
      <div className="aie2-art-modules">
        {(
          [
            ["support", "обращения"],
            ["knowledge", "база знаний"],
            ["billing", "тарифы и оплата"],
          ] as const
        ).map(([name, role]) => (
          <div key={name}>
            <b>
              <Boxes /> {name}
            </b>
            <i>{role}</i>
          </div>
        ))}
      </div>
    ),
  },
  "Продукт и требования": {
    size: "narrow",
    tone: "sand",
    art: (
      <div className="aie2-art-story">
        <span>
          <UserRound /> Оператор хочет
        </span>
        <p>получать черновик ответа со ссылками на базу знаний</p>
        <span>
          <Check /> 3 критерия готовности
        </span>
      </div>
    ),
  },
  "Существующий проект": {
    size: "narrow",
    tone: "sand",
    art: (
      <div className="aie-art-pipeline">
        <span>
          <Search />
          Разобраться в коде
        </span>
        <span>
          <ShieldCheck />
          Покрыть тестами
        </span>
        <span>
          <Boxes />
          Улучшить по частям
        </span>
      </div>
    ),
  },
  "Тесты и проверки": {
    size: "narrow",
    tone: "blue",
    art: (
      <div className="aie2-art-checks">
        {["Тесты поведения", "Границы модулей", "Типы и линтер", "CI"].map(
          (label) => (
            <span key={label}>
              <Check /> {label}
            </span>
          ),
        )}
      </div>
    ),
  },
  "Релизы и эксплуатация": {
    size: "narrow",
    tone: "example",
    art: (
      <div className="aie-art-tree">
        <span>
          <GitPullRequest /> pull request
        </span>
        <span>
          <Rocket /> релиз
        </span>
        <span>
          <Database /> миграции
        </span>
        <span>
          <Activity /> наблюдаемость
        </span>
      </div>
    ),
  },
  "Spec-Driven Development": {
    size: "wide",
    tone: "blue",
    art: (
      <div className="aie2-art-sdd">
        {["Спецификация", "Реализация", "Проверки", "Релиз"].map(
          (label, index) => (
            <span key={label}>
              {index === 0 ? null : (
                <ArrowRight className="aie2-art-sdd-arrow" />
              )}
              <b>{label}</b>
            </span>
          ),
        )}
      </div>
    ),
  },
  Harness: {
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
          hooks/
        </span>
      </div>
    ),
  },
  "Human in the loop": {
    size: "narrow",
    tone: "sand",
    art: (
      <div className="aie-art-guard">
        <span className="aie-art-guard-action">
          <Bot />
          Изменение готово
        </span>
        <span className="aie-art-guard-gate">
          <ShieldCheck />
          Проверки пройдены
        </span>
        <span className="aie-art-guard-buttons">
          <b>
            <UserRound />
            Решаешь ты
          </b>
          <b>Принято</b>
        </span>
      </div>
    ),
  },
  "Несколько агентов": {
    size: "wide",
    tone: "lavender",
    art: (
      <div className="aie-art-team">
        <span>
          <UserRound /> Задача и критерии
        </span>
        <div className="aie-art-team-agents">
          <span>
            <Bot /> Код
          </span>
          <span>
            <Bot /> Тесты
          </span>
          <span>
            <Bot /> Ревью
          </span>
        </div>
        <span>
          <GitPullRequest /> Согласованный результат
        </span>
      </div>
    ),
  },
  "Контекст и память": {
    size: "wide",
    tone: "coral",
    art: (
      <div className="aie-art-memory">
        <div className="aie-art-memory-sources">
          <span>
            <MessagesSquare /> Сессия
          </span>
          <span>
            <FileText /> Знания
          </span>
          <span>
            <Search /> Поиск
          </span>
        </div>
        <div className="aie-art-memory-context">
          <Layers /> Нужный контекст
        </div>
        <span className="aie-art-memory-agent">
          <Bot /> Агент помнит важное
        </span>
      </div>
    ),
  },
  "Собственные агенты и MCP": {
    size: "wide",
    tone: "ink",
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
            <Plug />
            MCP
          </span>
          <span>
            <Search />
            RAG
          </span>
          <span>
            <Wrench />
            Инструменты
          </span>
        </div>
      </div>
    ),
  },
  "Безопасность агентов": {
    size: "narrow",
    tone: "good",
    art: (
      <div className="aie2-art-security">
        <span className="aie2-art-security-agent">
          <Bot /> Агент в песочнице
        </span>
        <div>
          <span>
            <Check /> Читать репозиторий
          </span>
          <span>
            <Check /> Запускать тесты
          </span>
          <span data-denied="true">
            <Lock /> Секреты и продакшн
          </span>
          <span data-denied="true">
            <Ban /> Prompt injection
          </span>
        </div>
      </div>
    ),
  },
  "Evals и стоимость": {
    size: "narrow",
    tone: "lavender",
    art: (
      <div className="aie-art-evals">
        {[42, 58, 51, 74, 69, 86].map((value, index) => (
          <i
            data-after={index >= 3}
            key={`${String(index)}-${String(value)}`}
            style={{ blockSize: `${String(value)}%` }}
          />
        ))}
        <span>
          <Gauge />
          качество по версиям
        </span>
      </div>
    ),
  },
};
/** Темы курса и под ними кнопка в программу: там главы и уроки по этим темам. */
function TopicGrid({
  block,
  programme,
}: {
  readonly block: ProductPageBlockOf<"cards">;
  readonly programme: Route;
}) {
  return (
    <section className="ai-product-outcomes aie-topics">
      <h2>{block.title}</h2>
      {block.lead === "" ? null : (
        <p className="ai-product-section-intro ai-product-promise">
          {block.lead}
        </p>
      )}
      <ul className="aie-bento">
        {block.items.map((item) => {
          const tile = topicTiles[item.title];
          return (
            <li
              data-size={tile?.size ?? "narrow"}
              data-tone={tile?.tone ?? "sand"}
              key={item.title}
            >
              {tile === undefined ? null : (
                <div aria-hidden="true" className="aie-bento-art">
                  {tile.art}
                </div>
              )}
              <div className="aie-bento-copy">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <IntentPrefetchLink className="aie-topics-programme" href={programme}>
        Открыть программу
        <ArrowRight aria-hidden="true" />
      </IntentPrefetchLink>
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
  <div className="aie-mock-task" key="task">
    <small>Задание 2.3</small>
    <b>Спроектируй вход в систему</b>
    <ul>
      <li>
        <Check />
        Спецификация
      </li>
      <li>
        <Check />
        Реализация
      </li>
      <li>
        <Check />
        Тесты
      </li>
    </ul>
    <span>
      <ShieldCheck />
      Проверено
    </span>
  </div>,
  <div className="aie-mock-decision" key="decision">
    <span className="aie-mock-decision-ask">
      <Bot />
      Как хранить сессии?
    </span>
    <span>В памяти сервера</span>
    <span data-chosen="true">
      <Check />
      Токены с ротацией
    </span>
    <small>решаешь ты</small>
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
      {block.note === "" ? null : <FaqContact note={block.note} />}
    </section>
  );
}

/**
 * Подпись под вопросами: текст автора и кнопка Telegram. Ник хранится в описании курса, а не в
 * коде; в тексте он не печатается, его заменяет кнопка (решение владельца 09.10.2026). Правило
 * Telegram для ника: 5–32 символа, латиница, цифры и подчёркивание.
 */
function FaqContact({ note }: { readonly note: string }) {
  const handle = /@([A-Za-z][A-Za-z0-9_]{4,31})/u.exec(note)?.[1];
  const text =
    handle === undefined ? note : note.replace(`@${handle}`, "").trim();
  return (
    <div className="aie-faq-note">
      <span>{text}</span>
      {handle === undefined ? null : (
        <a
          className="aie-telegram-button"
          href={`https://t.me/${handle}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <TelegramLogo />
          Написать в Telegram
        </a>
      )}
    </div>
  );
}

/** Знак Telegram (Simple Icons, CC0): бумажный самолёт в круге, цвет задаёт кнопка. */
function TelegramLogo() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

/**
 * Значки пунктов «что входит» по порядку описания курса: доступ к курсу, менторинг, практика,
 * сообщество. Лишний пункт получает галочку.
 */
const statusIcons: readonly CourseIconName[] = [
  "materials",
  "questions",
  "check",
  "telegram",
];

/**
 * Личная часть нижнего блока для участника курса. Состав курса и кнопка в программу ему уже не
 * нужны: продолжить обучение можно с анимации первого экрана. Метка приходит вместе с личной
 * частью страницы и скрывает весь блок.
 */

function Status({
  block,
  call,
  programme,
}: {
  readonly block: ProductPageBlockOf<"list">;
  /**
   * Плашка набора на поток. Пока она есть, она стоит вместо заголовка и кнопки блока; без неё
   * блок показывает свой текст из описания курса. Метка участника `LearnerCourseStatus` убирает
   * блок целиком.
   */
  readonly call?: ReactNode;
  readonly programme: Route;
}) {
  return (
    // Якорь цены — только у блока набора: прочие блоки-списки рисуются тем же компонентом.
    <section
      className="aie-status"
      id={block.id === "status" ? cohortEnrollAnchor : undefined}
    >
      <div className="aie-status-lead">
        <div className="aie-status-default">
          <h2>{block.title}</h2>
          {block.text === "" ? null : <p>{block.text}</p>}
        </div>
        {call}
      </div>
      <ul>
        {block.items.map((item, index) => {
          const icon = statusIcons[index];
          return (
            <li key={`${String(index)}-${item}`}>
              {icon === undefined ? (
                <Check aria-hidden="true" />
              ) : (
                <CourseIcon name={icon} />
              )}
              {item}
            </li>
          );
        })}
      </ul>
      <IntentPrefetchLink
        className="aie-status-button aie-status-default"
        href={programme}
      >
        Открыть программу
        <ArrowRight />
      </IntentPrefetchLink>
    </section>
  );
}

/* ---------- PROTOTYPE: новые разделы ---------- */

/** Моя позиция: короткий тезис слева, схема «агент и ты» справа. */
function Position({ block }: { readonly block: ProductPageBlockOf<"cards"> }) {
  return (
    <section className="aie2-position">
      <div className="aie2-position-copy">
        <h2>{block.title}</h2>
        {block.lead === "" ? null : <p>{block.lead}</p>}
      </div>
      <dl className="aie2-roles">
        {block.items.map((role, index) => (
          <div data-role={index === 0 ? "agent" : "you"} key={role.title}>
            <dt>
              {index === 0 ? (
                <Bot aria-hidden="true" />
              ) : (
                <UserRound aria-hidden="true" />
              )}
              {role.title}
            </dt>
            <dd>
              {role.text.split(", ").map((topic) => (
                <span key={topic}>{topic}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Artifacts({ block }: { readonly block: ProductPageBlockOf<"text"> }) {
  return (
    <section className="aie2-artifacts">
      <div>
        <h2>{block.title}</h2>
        {block.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <ArtifactWindow />
    </section>
  );
}
