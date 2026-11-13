import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  type LucideIcon,
  Play,
  Search,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ContentCoverImage, type ContentCover } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { publicPageEnvironment } from "@/storybook/story-environment";
import "./product-programme-view.css";

// Throwaway (owner request 2026-11-13): on the «Материалы» catalogue a reader cannot tell a video
// from a text, especially a video without a cover (its dark title card says «ГАЙД»), and six topic
// chips are too many. Variants differ in how the format shows; every variant except «0» shows the
// proposed three topics. Fixture data only; topic membership is a guess for the picture.

type Medium = "video" | "text";

interface Card {
  readonly slug: string;
  readonly title: string;
  readonly medium: Medium;
  /** Genre the production card prints today («Гайд», «Заметка», «Видео»). */
  readonly genre: string;
  readonly cover: ContentCover | null;
  readonly duration?: string;
  readonly read?: boolean;
  readonly place?: string;
}

const cover = (index: number): ContentCover => ({
  coverId: `27100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  renditions: [{ width: 960, height: 540 }],
});

const all = {
  benefit: {
    slug: "benefit",
    title: "Как проверить пользу изменений harness",
    medium: "text",
    genre: "Гайд",
    cover: null,
  },
  sessions: {
    slug: "sessions",
    title: "Как разбирать сессии и улучшать harness",
    medium: "text",
    genre: "Гайд",
    cover: null,
  },
  rules: {
    slug: "rules",
    title: "Как передавать правила исполнителю и ревьюеру",
    medium: "text",
    genre: "Гайд",
    cover: null,
  },
  course: {
    slug: "course",
    title: "Как устроен курс",
    medium: "text",
    genre: "Гайд",
    cover: null,
    read: true,
    place: "Глава 1 · урок 1",
  },
  agentChoice: {
    slug: "agent-choice",
    title: "Выбор агента и модели",
    medium: "video",
    genre: "Видео",
    cover: cover(5),
    duration: "9:23",
    place: "Глава 1 · урок 2",
  },
  agentBasics: {
    slug: "agent-basics",
    title: "Как агент работает с проектом: контекст, инструменты и harness",
    medium: "video",
    genre: "Видео",
    cover: cover(6),
    duration: "7:07",
    place: "Глава 1 · урок 3",
  },
  firstVersion: {
    slug: "first-version",
    title: "Первая версия продукта",
    medium: "video",
    genre: "Видео",
    cover: cover(4),
    duration: "4:16",
    place: "Глава 1 · урок 6",
  },
  grilling: {
    slug: "grilling",
    title: "Проектирование с агентом через grilling",
    medium: "video",
    genre: "Гайд",
    cover: null,
    duration: "23:40",
    place: "Глава 1 · урок 7",
  },
  domain: {
    slug: "domain",
    title: "Домен и общий язык",
    medium: "video",
    genre: "Видео",
    cover: cover(7),
    duration: "5:52",
    place: "Глава 1 · урок 8",
  },
  pipeline: {
    slug: "pipeline",
    title: "Цикл разработки от спецификации: от обсуждения до pull request",
    medium: "text",
    genre: "Гайд",
    cover: null,
    place: "Глава 1 · урок 9",
  },
  storybook: {
    slug: "storybook",
    title: "Работа над дизайном в Storybook",
    medium: "video",
    genre: "Видео",
    cover: cover(8),
    duration: "18:25",
  },
  existing: {
    slug: "existing",
    title: "Как работать с агентом в существующем проекте",
    medium: "text",
    genre: "Гайд",
    cover: cover(9),
  },
  models: {
    slug: "models",
    title: "Какие модели я использую сейчас",
    medium: "text",
    genre: "Заметка",
    cover: null,
  },
} as const satisfies Record<string, Card>;

const newest: readonly Card[] = [all.benefit, all.sessions, all.rules];

interface Shelf {
  readonly name: string;
  readonly total: number;
  readonly cards: readonly Card[];
}

const currentTopics = [
  "Старт с агентом",
  "Проектирование",
  "Разработка и проверки",
  "Улучшение harness",
  "Дизайн и интерфейс",
  "Проект курса",
];
const currentShelves: readonly Shelf[] = [
  {
    name: "Старт с агентом",
    total: 7,
    cards: [all.course, all.agentChoice, all.agentBasics],
  },
  {
    name: "Проектирование",
    total: 4,
    cards: [all.firstVersion, all.grilling, all.domain],
  },
];

/** Proposed three topics: «Старт» + «Проект курса», «Проектирование» + «Дизайн и интерфейс»,
 * «Разработка и проверки» + «Улучшение harness». */
const threeTopics = ["Старт", "Проектирование", "Разработка"];
const threeShelves: readonly Shelf[] = [
  {
    name: "Старт",
    total: 9,
    cards: [all.course, all.agentChoice, all.agentBasics],
  },
  {
    name: "Проектирование",
    total: 6,
    cards: [all.firstVersion, all.grilling, all.storybook],
  },
  {
    name: "Разработка",
    total: 7,
    cards: [all.pipeline, all.existing, all.models],
  },
];

const mediumIcon: Readonly<Record<Medium, LucideIcon>> = {
  video: Play,
  text: FileText,
};

function MediumIcon({
  medium,
  className,
}: {
  readonly medium: Medium;
  readonly className: string;
}) {
  const Icon = mediumIcon[medium];
  return (
    <Icon
      aria-hidden="true"
      className={className}
      {...(medium === "video" ? { fill: "currentColor" } : {})}
    />
  );
}

function ReadMark({ card }: { readonly card: Card }) {
  return card.read === true ? (
    <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-white/90 text-foreground shadow-sm">
      <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
    </span>
  ) : null;
}

function CoverPicture({ card }: { readonly card: Card }) {
  return card.cover === null ? null : (
    <ContentCoverImage
      alt=""
      className="aspect-video w-full rounded-2xl"
      cover={card.cover}
      fallbackSeed={card.slug}
    />
  );
}

/** The dark title card that stands in for a missing cover. */
function TitleCard({
  card,
  caption,
  center,
}: {
  readonly card: Card;
  readonly caption: ReactNode;
  readonly center?: ReactNode;
}) {
  return (
    <span className="block w-full overflow-hidden rounded-2xl [container-type:inline-size]">
      <span className="relative flex aspect-video w-full flex-col justify-center gap-[2.5cqw] bg-cover-ink px-[6cqw] pt-[8cqw] pb-[16cqw] text-white">
        {caption === null ? null : (
          <span className="inline-flex items-center gap-1.5 text-[clamp(0.625rem,2.6cqw,0.75rem)] font-semibold tracking-[0.08em] uppercase opacity-75">
            {caption}
          </span>
        )}
        <span className="line-clamp-3 pr-[14cqw] text-[clamp(0.875rem,6.2cqw,1.5rem)] leading-[1.16] font-medium tracking-[-0.01em]">
          {card.title}
        </span>
        <span
          aria-hidden="true"
          className="absolute bottom-[6cqw] left-[6cqw] h-0.5 w-[10cqw] bg-accent"
        />
        {center}
      </span>
    </span>
  );
}

function Place({ card }: { readonly card: Card }) {
  return card.place === undefined ? null : (
    <span className="-mb-1 px-1.5 text-xs font-medium text-muted-foreground">
      {card.place}
    </span>
  );
}

function BelowTitle({ card }: { readonly card: Card }) {
  return card.cover === null ? null : (
    <span className="line-clamp-2 px-1.5 text-[0.9375rem] leading-5 font-semibold tracking-[-0.01em]">
      {card.title}
    </span>
  );
}

const pill =
  "absolute right-2 bottom-2 inline-flex min-h-5 items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums";

/** 0. Production today: genre in the caption, a bare icon in the corner. */
function CurrentCard({ card }: { readonly card: Card }) {
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <span className="relative block">
        {card.cover === null ? (
          <TitleCard card={card} caption={card.genre} />
        ) : (
          <CoverPicture card={card} />
        )}
        <ReadMark card={card} />
        <span className={pill}>
          <MediumIcon className="size-3" medium={card.medium} />
          {card.duration}
        </span>
      </span>
      <Place card={card} />
      <BelowTitle card={card} />
    </article>
  );
}

/** A. Same card, the format spelled out: a labelled pill and the medium in the caption; a video
 * without a cover also gets a play button. */
function LabelledCard({ card }: { readonly card: Card }) {
  const video = card.medium === "video";
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <span className="relative block">
        {card.cover === null ? (
          <TitleCard
            card={card}
            caption={null}
            center={
              video ? (
                <span className="absolute top-1/2 right-[6cqw] grid size-[13cqw] -translate-y-1/2 place-items-center rounded-full bg-white/15 ring-1 ring-white/25">
                  <Play
                    aria-hidden="true"
                    className="ml-[0.6cqw] size-[5cqw]"
                    fill="currentColor"
                  />
                </span>
              ) : null
            }
          />
        ) : (
          <CoverPicture card={card} />
        )}
        <ReadMark card={card} />
        <span
          className={cn(
            pill,
            "gap-1.5 px-2.5 text-xs",
            video ? "bg-accent text-white" : "bg-white text-foreground",
          )}
        >
          <MediumIcon className="size-3" medium={card.medium} />
          {video ? `Видео · ${card.duration ?? ""}` : "Текст"}
        </span>
      </span>
      <Place card={card} />
      <BelowTitle card={card} />
    </article>
  );
}

/** B. Two kinds of cards: a video is a dark screen with a play button; a text is a light page. */
function ScreenOrPageCard({ card }: { readonly card: Card }) {
  if (card.medium === "video") {
    const play = (
      <span className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur-sm transition-transform group-hover/card:scale-110">
        <Play
          aria-hidden="true"
          className="ml-0.5 size-5"
          fill="currentColor"
        />
      </span>
    );
    return (
      <article className="group/card flex min-w-0 flex-col gap-2">
        <span className="relative block [container-type:inline-size]">
          {card.cover === null ? (
            <span className="relative flex aspect-video w-full flex-col justify-between overflow-hidden rounded-2xl bg-cover-ink p-[6cqw] text-white">
              <span className="grid size-[clamp(1.75rem,12cqw,2.5rem)] place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
                <Play
                  aria-hidden="true"
                  className="ml-0.5 size-4"
                  fill="currentColor"
                />
              </span>
              <span className="line-clamp-2 pr-[18cqw] text-[clamp(0.8125rem,6cqw,1rem)] leading-[1.2] font-medium">
                {card.title}
              </span>
            </span>
          ) : (
            <CoverPicture card={card} />
          )}
          {card.cover === null ? null : play}
          <ReadMark card={card} />
          <span className={pill}>{card.duration}</span>
        </span>
        <Place card={card} />
        <BelowTitle card={card} />
      </article>
    );
  }
  return (
    <article className="group/card flex min-w-0 flex-col gap-2">
      <span className="relative block [container-type:inline-size]">
        {card.cover === null ? (
          <span className="relative flex aspect-video w-full flex-col overflow-hidden rounded-2xl border border-black/10 bg-white px-[6cqw] py-[6cqw] shadow-card">
            <span className="inline-flex items-center gap-1 text-[clamp(0.5625rem,2.8cqw,0.7rem)] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <FileText aria-hidden="true" className="size-3" />
              Текст
            </span>
            <span className="mt-[2cqw] line-clamp-3 text-[clamp(0.8125rem,6cqw,1.375rem)] leading-[1.18] font-semibold tracking-[-0.01em] text-foreground">
              {card.title}
            </span>
            <span
              aria-hidden="true"
              className="mt-auto grid gap-1.5 max-[30rem]:hidden"
            >
              <span className="h-1 w-[85%] rounded bg-black/7" />
              <span className="h-1 w-[60%] rounded bg-black/7" />
            </span>
            {/* folded corner of a page */}
            <span
              aria-hidden="true"
              className="absolute top-0 right-0 size-6 bg-[linear-gradient(225deg,var(--color-background)_50%,rgb(0_0_0/0.08)_50%)]"
            />
          </span>
        ) : (
          <span className="relative block">
            <CoverPicture card={card} />
            <span className="absolute inset-x-2 bottom-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-foreground shadow-sm">
              <FileText aria-hidden="true" className="size-3" />
              Текст
            </span>
          </span>
        )}
        <ReadMark card={card} />
      </span>
      <Place card={card} />
      <BelowTitle card={card} />
    </article>
  );
}

/** C. Nothing on the picture but the duration; the format is a coloured line under it, together
 * with the place in the programme. */
function FormatLineCard({ card }: { readonly card: Card }) {
  const video = card.medium === "video";
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <span className="relative block">
        {card.cover === null ? (
          <TitleCard card={card} caption={null} />
        ) : (
          <CoverPicture card={card} />
        )}
        <ReadMark card={card} />
        {card.duration === undefined ? null : (
          <span className={pill}>{card.duration}</span>
        )}
      </span>
      <span className="-mb-1 inline-flex flex-wrap items-center gap-x-1.5 px-1.5 text-xs font-semibold">
        <span
          className={cn(
            "inline-flex items-center gap-1",
            video ? "text-action" : "text-foreground",
          )}
        >
          <MediumIcon className="size-3" medium={card.medium} />
          {video ? `Видео · ${card.duration ?? ""}` : "Текст"}
        </span>
        {card.place === undefined ? null : (
          <span className="font-medium text-muted-foreground">
            · {card.place}
          </span>
        )}
      </span>
      <BelowTitle card={card} />
    </article>
  );
}

interface Variant {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly topics: readonly string[];
  readonly shelves: readonly Shelf[];
  readonly card: (card: Card) => ReactNode;
}

const variants: readonly Variant[] = [
  {
    id: "0",
    name: "Как сейчас",
    note: "Шесть тем. На тёмной карточке жанр («Гайд»), формат только значком в углу.",
    topics: currentTopics,
    shelves: currentShelves,
    card: (card) => <CurrentCard card={card} />,
  },
  {
    id: "A",
    name: "Подпись формата",
    note: "Три темы. В углу «▶ Видео · 23:40» (цветной) или «Текст» (белый). У видео без обложки кнопка ▶.",
    topics: threeTopics,
    shelves: threeShelves,
    card: (card) => <LabelledCard card={card} />,
  },
  {
    id: "B",
    name: "Экран и страница",
    note: "Три темы. Видео: кнопка ▶ на картинке, без обложки тёмный экран. Текст без обложки: светлая страница.",
    topics: threeTopics,
    shelves: threeShelves,
    card: (card) => <ScreenOrPageCard card={card} />,
  },
  {
    id: "C",
    name: "Формат строкой",
    note: "Три темы. На картинке только длительность. Под ней строка «▶ Видео · 23:40 · Глава 1 · урок 2».",
    topics: threeTopics,
    shelves: threeShelves,
    card: (card) => <FormatLineCard card={card} />,
  },
];

function CatalogBlock({ variant }: { readonly variant: Variant }) {
  return (
    <div
      className="@container/catalog min-w-0"
      data-prototype-variant={variant.id}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
          Материалы
        </h2>
        <span className="inline-flex rounded-full bg-muted p-1 text-sm font-medium">
          <span className="rounded-full bg-white px-3 py-1 shadow-sm">Всё</span>
          <span className="px-3 py-1 text-muted-foreground">Видео</span>
          <span className="px-3 py-1 text-muted-foreground">Тексты</span>
        </span>
      </div>
      <div className="mb-3 flex h-11 items-center gap-2 rounded-full bg-muted px-4 text-muted-foreground">
        <Search aria-hidden="true" className="size-4" />
        Найти материал
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {["Все темы", ...variant.topics].map((topic, index) => (
          <span
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium",
              index === 0
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground",
            )}
            key={topic}
          >
            {topic}
          </span>
        ))}
      </div>
      <section className="mb-8">
        <h3 className="mb-3 text-lg font-semibold tracking-[-0.01em]">Новое</h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 @min-[34rem]/catalog:grid-cols-3 @min-[34rem]/catalog:gap-x-4">
          {newest.map((card) => (
            <li className="min-w-0" key={card.slug}>
              {variant.card(card)}
            </li>
          ))}
        </ul>
      </section>
      {variant.shelves.map((shelf) => (
        <section className="mb-8" key={shelf.name}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-[-0.01em]">
              {shelf.name}
            </h3>
            <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-action">
              Все {shelf.total}
              <ChevronRight aria-hidden="true" className="size-4" />
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-5 @min-[34rem]/catalog:grid-cols-3 @min-[34rem]/catalog:gap-x-4">
            {shelf.cards.map((card) => (
              <li className="min-w-0" key={card.slug}>
                {variant.card(card)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function readVariant(): number {
  const value = new URLSearchParams(location.search).get("variant");
  const index = variants.findIndex((entry) => entry.id === value);
  return index < 0 ? 0 : index;
}

function Comparison({ initialVariant }: { readonly initialVariant?: string }) {
  const [index, setIndex] = useState(() =>
    initialVariant === undefined
      ? readVariant()
      : Math.max(
          0,
          variants.findIndex((entry) => entry.id === initialVariant),
        ),
  );
  const change = (value: number) => {
    const next = (value + variants.length) % variants.length;
    setIndex(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", variants[next]?.id ?? "0");
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        change(index + (event.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  });
  const current = variants[index] ?? variants[0];
  if (current === undefined) return null;
  return (
    <div className="programme-frame mx-auto px-4 pt-6 pb-40 sm:px-6">
      <CatalogBlock variant={current} />
      <nav
        aria-label="Варианты карточек"
        className="fixed bottom-4 left-1/2 z-50 flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-foreground p-2 text-background shadow-xl"
      >
        <button
          aria-label="Предыдущий вариант"
          className="grid size-11 place-items-center rounded-lg hover:bg-background/15"
          onClick={() => {
            change(index - 1);
          }}
          type="button"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="grid max-w-[24rem] min-w-[12rem] text-center">
          <small className="text-[0.6875rem] opacity-75">
            Прототип · {current.id} · {index + 1} из {variants.length}
          </small>
          <strong className="text-sm font-semibold">{current.name}</strong>
          <span className="text-xs leading-[1.1rem] opacity-80 max-sm:hidden">
            {current.note}
          </span>
        </div>
        <button
          aria-label="Следующий вариант"
          className="grid size-11 place-items-center rounded-lg hover:bg-background/15"
          onClick={() => {
            change(index + 1);
          }}
          type="button"
        >
          <ArrowRight size={18} />
        </button>
      </nav>
    </div>
  );
}

const meta = {
  ...publicPageEnvironment("/products/ai-engineering/materials", {
    account: "authenticated",
  }),
  title: "Prototypes/Library Card Format",
  component: Comparison,
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {};
export const CompareMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
