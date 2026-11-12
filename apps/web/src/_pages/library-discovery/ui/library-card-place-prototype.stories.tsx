import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  type LucideIcon,
  NotebookPen,
  Play,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ContentCoverImage, type ContentCover } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { publicPageEnvironment } from "@/storybook/story-environment";
import "./product-programme-view.css";

// Throwaway: where the «Глава N · урок M» place of a catalogue card stands. In production it sits
// at the bottom of a stretched card (mt-auto), so under a title card without a cover it floats far
// below the picture and reads as part of the next row. Fixture data only.

type Format = "video" | "guide" | "note";

interface Card {
  readonly slug: string;
  readonly title: string;
  readonly format: Format;
  readonly cover: ContentCover | null;
  readonly duration?: string;
  readonly read?: boolean;
  readonly place: { readonly chapter: number; readonly lesson: number } | null;
}

const cover = (index: number): ContentCover => ({
  coverId: `27100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  renditions: [{ width: 960, height: 540 }],
});

const cards: readonly Card[] = [
  {
    slug: "course",
    title: "Как устроен курс",
    format: "guide",
    cover: null,
    read: true,
    place: { chapter: 1, lesson: 1 },
  },
  {
    slug: "agent-choice",
    title: "Выбор агента и модели",
    format: "video",
    cover: cover(5),
    duration: "9:23",
    place: { chapter: 1, lesson: 2 },
  },
  {
    slug: "agent-basics",
    title: "Как агент работает с проектом: контекст, инструменты и harness",
    format: "video",
    cover: cover(6),
    duration: "7:07",
    place: { chapter: 1, lesson: 3 },
  },
  {
    slug: "grilling",
    title: "Проектирование с агентом через grilling",
    format: "video",
    cover: null,
    duration: "23:40",
    place: { chapter: 1, lesson: 7 },
  },
  {
    slug: "domain",
    title: "Домен и общий язык",
    format: "video",
    cover: cover(7),
    duration: "5:52",
    place: { chapter: 1, lesson: 8 },
  },
  {
    slug: "pipeline",
    title: "Цикл разработки от спецификации: от обсуждения до pull request",
    format: "guide",
    cover: null,
    place: { chapter: 1, lesson: 9 },
  },
  {
    slug: "existing",
    title: "Как работать с агентом в существующем проекте",
    format: "guide",
    cover: null,
    place: null,
  },
  {
    slug: "storybook",
    title: "Работа над дизайном в Storybook",
    format: "video",
    cover: cover(8),
    duration: "18:25",
    place: null,
  },
  {
    slug: "models",
    title: "Какие модели я использую сейчас",
    format: "note",
    cover: null,
    place: null,
  },
];

const formatLabel: Readonly<Record<Format, string>> = {
  video: "Видео",
  guide: "Гайд",
  note: "Заметка",
};
const formatIcon: Readonly<Record<Format, LucideIcon>> = {
  video: Play,
  guide: FileText,
  note: NotebookPen,
};

const placeText = (card: Card) =>
  card.place === null
    ? null
    : `Глава ${String(card.place.chapter)} · урок ${String(card.place.lesson)}`;

/** Where the place goes; each variant fills only some of them. */
interface Slots {
  /** A pill in the top-left corner of the picture. */
  readonly onPicture?: boolean;
  /** Inside the title card, in its caption line after the format. */
  readonly inCaption?: boolean;
  /** A line right under the picture or the title, not pushed to the bottom. */
  readonly below?: "line" | "chip" | "above-title" | "under-picture" | null;
}

function FormatBadge({ card }: { readonly card: Card }) {
  const Icon = formatIcon[card.format];
  return (
    <span className="absolute right-2 bottom-2 inline-flex min-h-5 items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums">
      <Icon
        aria-hidden="true"
        className="size-3"
        {...(card.format === "video" ? { fill: "currentColor" } : {})}
      />
      {card.duration}
    </span>
  );
}

function Picture({
  card,
  slots,
}: {
  readonly card: Card;
  readonly slots: Slots;
}) {
  const place = placeText(card);
  return (
    <span className="relative block">
      {card.cover === null ? (
        <span className="block w-full overflow-hidden rounded-2xl [container-type:inline-size]">
          <span className="relative flex aspect-video w-full flex-col justify-center gap-[2.5cqw] bg-cover-ink px-[6cqw] py-[8cqw] text-white">
            <span className="text-[clamp(0.625rem,2.6cqw,0.75rem)] font-semibold tracking-[0.08em] uppercase opacity-75">
              {formatLabel[card.format]}
              {slots.inCaption === true && place !== null ? ` · ${place}` : ""}
            </span>
            <span className="line-clamp-3 text-[clamp(0.9375rem,6.2cqw,1.5rem)] leading-[1.16] font-medium tracking-[-0.01em]">
              {card.title}
            </span>
            <span
              aria-hidden="true"
              className="absolute bottom-[6cqw] left-[6cqw] h-0.5 w-[10cqw] bg-accent"
            />
          </span>
        </span>
      ) : (
        <ContentCoverImage
          alt=""
          className="aspect-video w-full rounded-2xl"
          cover={card.cover}
          fallbackSeed={card.slug}
        />
      )}
      {slots.onPicture === true && place !== null ? (
        <span className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums">
          {place}
        </span>
      ) : null}
      {card.read === true ? (
        <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-white/90 text-foreground shadow-sm">
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
        </span>
      ) : null}
      <FormatBadge card={card} />
    </span>
  );
}

function PrototypeCard({
  card,
  slots,
}: {
  readonly card: Card;
  readonly slots: Slots;
}) {
  const place = placeText(card);
  const titled = card.cover === null;
  const title = (
    <span className="line-clamp-2 text-[0.9375rem] leading-5 font-semibold tracking-[-0.01em]">
      {card.title}
    </span>
  );
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <Picture card={card} slots={slots} />
      {slots.below === "under-picture" && place !== null ? (
        <span className="-mb-1 text-xs font-medium text-muted-foreground">
          {place}
        </span>
      ) : null}
      {slots.below === "above-title" && place !== null && !titled ? (
        <span className="-mb-1 text-xs font-medium text-muted-foreground">
          {place}
        </span>
      ) : null}
      {titled ? null : title}
      {slots.below === "line" && place !== null ? (
        <span className="text-xs text-muted-foreground">{place}</span>
      ) : null}
      {slots.below === "chip" && place !== null ? (
        <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {place}
        </span>
      ) : null}
    </article>
  );
}

/** Production today: the place is pushed to the bottom of a card stretched to its row height. */
function CurrentCard({ card }: { readonly card: Card }) {
  const place = placeText(card);
  return (
    <article className="flex h-full min-w-0 flex-col gap-2">
      <Picture card={card} slots={{}} />
      {card.cover === null ? null : (
        <span className="line-clamp-2 text-[0.9375rem] leading-5 font-semibold tracking-[-0.01em]">
          {card.title}
        </span>
      )}
      {place === null ? null : (
        <span className="mt-auto text-xs text-muted-foreground">{place}</span>
      )}
    </article>
  );
}

const variants: readonly {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly card: (card: Card) => ReactNode;
}[] = [
  {
    id: "0",
    name: "Как сейчас",
    note: "Подпись прижата к низу растянутой карточки и уплывает к следующему ряду.",
    card: (card) => <CurrentCard card={card} />,
  },
  {
    id: "A",
    name: "Бейдж на картинке",
    note: "«Глава 1 · урок 1» в левом верхнем углу картинки. Под карточкой только название.",
    card: (card) => <PrototypeCard card={card} slots={{ onPicture: true }} />,
  },
  {
    id: "B",
    name: "Чип сразу под карточкой",
    note: "Серый чип вплотную под картинкой или названием, без отступа до низа ряда.",
    card: (card) => <PrototypeCard card={card} slots={{ below: "chip" }} />,
  },
  {
    id: "C",
    name: "Место в подписи формата",
    note: "У тёмной карточки «ГАЙД · ГЛАВА 1 · УРОК 1» внутри; у карточки с обложкой место строкой над названием.",
    card: (card) => (
      <PrototypeCard
        card={card}
        slots={{ inCaption: true, below: "above-title" }}
      />
    ),
  },
  {
    id: "D",
    name: "Место под картинкой у всех",
    note: "Выбор владельца: строка «Глава 1 · урок 1» всегда прямо под картинкой, до названия, и у тёмных карточек тоже.",
    card: (card) => (
      <PrototypeCard card={card} slots={{ below: "under-picture" }} />
    ),
  },
];

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
      <div
        className="@container/catalog min-w-0"
        data-prototype-variant={current.id}
      >
        <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em] sm:text-xl">
          Все материалы
        </h2>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 @min-[34rem]/catalog:grid-cols-3 @min-[34rem]/catalog:gap-x-4">
          {cards.map((card) => (
            <li className="min-w-0" key={card.slug}>
              {current.card(card)}
            </li>
          ))}
        </ul>
      </div>
      <nav
        aria-label="Варианты подписи места"
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
        <div className="grid max-w-[22rem] min-w-[12rem] text-center">
          <small className="text-[0.6875rem] opacity-75">
            Прототип · {current.id} · {index + 1} из {variants.length}
          </small>
          <strong className="text-sm font-semibold">{current.name}</strong>
          <span
            className={cn(
              "text-xs leading-[1.1rem] opacity-80",
              "max-sm:hidden",
            )}
          >
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
  ...publicPageEnvironment("/products/ai-engineering/programme", {
    account: "authenticated",
  }),
  title: "Prototypes/Library Card Place",
  component: Comparison,
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {};
export const CompareMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
