import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  FileText,
  LayoutGrid,
  List,
  type LucideIcon,
  NotebookPen,
  Play,
  Search,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ContentCoverImage, type ContentCover } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { publicPageEnvironment } from "@/storybook/story-environment";
import "./product-programme-view.css";
import styles from "./material-catalog-layouts.prototype.module.css";

// Throwaway: four multi-column layouts for the Product «Материалы» library, inside the real public
// shell and programme frame. Fixture data only; production MaterialCatalog stays unchanged.

type Format = "video" | "guide" | "note";

interface LibraryItem {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly format: Format;
  readonly cover: ContentCover | null;
  /** Video length in seconds, or reading time in minutes for text. */
  readonly length: number;
  readonly publishedAt: string;
  readonly place: { readonly chapter: number; readonly lesson: number } | null;
  readonly read?: boolean;
}

const chapterNames = [
  "Основа разработки с агентами",
  "Первая версия продукта",
  "Поставка и эксплуатация",
] as const;

function cover(index: number, wide: boolean): ContentCover {
  return {
    coverId: `27100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    renditions: [{ width: 960, height: wide ? 540 : 960 }],
  };
}

const items: readonly LibraryItem[] = [
  {
    slug: "kak-ustroen-kurs",
    title: "Как устроен курс",
    summary:
      "Из чего состоит курс, как проходить главы и где задавать вопросы.",
    format: "guide",
    cover: null,
    length: 4,
    publishedAt: "2026-09-02",
    place: { chapter: 1, lesson: 1 },
    read: true,
  },
  {
    slug: "vybor-agenta",
    title: "Выбор агента и модели",
    summary:
      "Сравниваем агентов и модели по задачам, цене и контролю над окружением.",
    format: "guide",
    cover: cover(8, false),
    length: 11,
    publishedAt: "2026-09-04",
    place: { chapter: 1, lesson: 2 },
    read: true,
  },
  {
    slug: "kontekst-instrumenty",
    title: "Контекст, инструменты и harness агента",
    summary: "Что агент видит, чем действует и как окружение меняет результат.",
    format: "video",
    cover: cover(5, true),
    length: 1124,
    publishedAt: "2026-09-08",
    place: { chapter: 1, lesson: 3 },
    read: true,
  },
  {
    slug: "instrukcii-skilly",
    title: "Инструкции, скиллы и рабочее окружение",
    summary:
      "Пишем короткий AGENTS.md, подключаем скиллы и проверяем, что агент их применяет.",
    format: "guide",
    cover: null,
    length: 14,
    publishedAt: "2026-09-12",
    place: { chapter: 1, lesson: 4 },
  },
  {
    slug: "nachinaem-rabotu",
    title: "Начинаем работу с агентом в проекте",
    summary:
      "Видео, в котором я с агентом создаю проект, публикую его на GitHub, устанавливаю скиллы и пишу короткий AGENTS.md.",
    format: "video",
    cover: cover(6, true),
    length: 871,
    publishedAt: "2026-10-29",
    place: { chapter: 1, lesson: 5 },
  },
  {
    slug: "pervaya-versiya",
    title: "Первая версия продукта: сценарии и границы",
    summary:
      "Из брифа заказчика выделяем сценарии первой версии и то, что в неё не входит.",
    format: "guide",
    cover: cover(10, false),
    length: 9,
    publishedAt: "2026-09-20",
    place: { chapter: 2, lesson: 1 },
  },
  {
    slug: "domen",
    title: "Домен и общий язык",
    summary: "Словарь предметной области, который понимают и люди, и агент.",
    format: "guide",
    cover: null,
    length: 7,
    publishedAt: "2026-09-24",
    place: { chapter: 2, lesson: 2 },
  },
  {
    slug: "vybor-steka",
    title: "Выбор стека и границ модулей",
    summary:
      "Как выбрать технологию и разрезать систему на модули с понятными границами.",
    format: "video",
    cover: cover(7, true),
    length: 1490,
    publishedAt: "2026-10-01",
    place: { chapter: 2, lesson: 3 },
  },
  {
    slug: "testirovanie",
    title: "Тестирование, проверки архитектуры и CI",
    summary: "Какие проверки держат агента в рамках и как собрать их в CI.",
    format: "guide",
    cover: cover(9, false),
    length: 16,
    publishedAt: "2026-10-06",
    place: { chapter: 3, lesson: 1 },
  },
  {
    slug: "cikl-razrabotki",
    title: "Цикл разработки: от обсуждения до pull request",
    summary:
      "Задача, ветка, проверки, ревью и merge в одном повторяемом цикле.",
    format: "guide",
    cover: null,
    length: 12,
    publishedAt: "2026-10-10",
    place: { chapter: 3, lesson: 2 },
  },
  {
    slug: "itogi",
    title: "Итоги: основа проекта и процесс разработки",
    summary: "Собираем всё вместе и проверяем проект по чек-листу главы.",
    format: "note",
    cover: null,
    length: 3,
    publishedAt: "2026-10-14",
    place: { chapter: 3, lesson: 3 },
  },
  {
    slug: "sushchestvuyushchiy-proekt",
    title: "Как работать с агентом в существующем проекте",
    summary:
      "Как изучить действующий проект и постепенно настроить инструкции, скиллы и проверки для работы с агентом.",
    format: "guide",
    cover: null,
    length: 10,
    publishedAt: "2026-10-28",
    place: null,
  },
  {
    slug: "polza-konteksta",
    title: "Проверка пользы контекста и инфраструктуры",
    summary:
      "Отдельно подтверждаем совместимость двух клиентов и пользу платформы в одном сценарии.",
    format: "guide",
    cover: null,
    length: 8,
    publishedAt: "2026-10-28",
    place: null,
  },
  {
    slug: "avtorizaciya-mcp",
    title: "Авторизация MCP и доступ агента",
    summary:
      "Проверяем текущие полномочия при каждом вызове и отдельно отзываем подключения.",
    format: "guide",
    cover: cover(11, false),
    length: 13,
    publishedAt: "2026-10-28",
    place: null,
  },
  {
    slug: "razbor-efira",
    title: "Разбор эфира: ревью проектов участников",
    summary:
      "Запись эфира, где разбираем три проекта и типичные ошибки в инструкциях.",
    format: "video",
    cover: null,
    length: 3260,
    publishedAt: "2026-10-22",
    place: null,
  },
  {
    slug: "zametka-modeli",
    title: "Какие модели я использую сейчас",
    summary: "Короткая заметка: что стоит в моём окружении и почему.",
    format: "note",
    cover: null,
    length: 2,
    publishedAt: "2026-10-26",
    place: null,
  },
  {
    slug: "zametka-revyu",
    title: "Почему ревью делает отдельный агент",
    summary: "Свежий контекст замечает то, что пропустил автор изменения.",
    format: "note",
    cover: null,
    length: 2,
    publishedAt: "2026-10-17",
    place: null,
  },
  {
    slug: "demo-relizy",
    title: "Демо: выпуск релиза через агента",
    summary: "Агент готовит релиз, а я проверяю каждый шаг перед выкладкой.",
    format: "video",
    cover: cover(5, true),
    length: 642,
    publishedAt: "2026-09-29",
    place: null,
  },
];

const formatLabels: Readonly<Record<Format, string>> = {
  video: "Видео",
  guide: "Гайд",
  note: "Заметка",
};
const formatIcons: Readonly<Record<Format, LucideIcon>> = {
  video: Clapperboard,
  guide: FileText,
  note: NotebookPen,
};
const variants = [
  {
    id: "A2",
    name: "Ровная сетка без подписей",
    note: "Выбран A. Формат, длительность и «изучено» на обложке, свежие материалы в группе «Новое», подписан только урок программы.",
  },
  {
    id: "A",
    name: "Ровная сетка",
    note: "Каждая карточка с картинкой одного размера; без обложки рисуется узор.",
  },
  {
    id: "B",
    name: "Полки по формату",
    note: "Видео с обложками отдельной полкой, тексты отдельной, внутри полки все одинаковые.",
  },
  {
    id: "C",
    name: "Мозаика",
    note: "Колонки без строк: разная высота задумана, пустых мест нет.",
  },
  {
    id: "D",
    name: "Плитки",
    note: "Плотные одинаковые плитки с квадратной миниатюрой, как список в библиотеке.",
  },
] as const;
type Sort = "new" | "programme";

function lengthLabel(item: LibraryItem): string {
  if (item.format !== "video") return `${String(item.length)} мин`;
  const minutes = Math.floor(item.length / 60);
  const seconds = item.length % 60;
  return minutes >= 60
    ? `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function placeLabel(item: LibraryItem): string {
  return item.place === null
    ? "Вне программы"
    : `Глава ${String(item.place.chapter)} · урок ${String(item.place.lesson)}`;
}

function isNew(item: LibraryItem): boolean {
  return item.publishedAt >= "2026-10-22";
}

const monthFormat = new Intl.DateTimeFormat("ru", {
  month: "long",
  year: "numeric",
});

interface Group {
  readonly id: string;
  readonly title: string;
  readonly items: readonly LibraryItem[];
}

function groupItems(shown: readonly LibraryItem[], sort: Sort): Group[] {
  const groups = new Map<string, { title: string; items: LibraryItem[] }>();
  const ordered = [...shown].sort((left, right) =>
    sort === "new"
      ? right.publishedAt.localeCompare(left.publishedAt)
      : (left.place?.chapter ?? 99) - (right.place?.chapter ?? 99) ||
        (left.place?.lesson ?? 0) - (right.place?.lesson ?? 0) ||
        right.publishedAt.localeCompare(left.publishedAt),
  );
  for (const item of ordered) {
    const id =
      sort === "new"
        ? isNew(item)
          ? "new"
          : item.publishedAt.slice(0, 7)
        : item.place === null
          ? "extra"
          : `chapter-${String(item.place.chapter)}`;
    const title =
      sort === "new"
        ? isNew(item)
          ? "Новое"
          : capitalize(
              monthFormat.format(new Date(`${item.publishedAt}T12:00:00`)),
            )
        : item.place === null
          ? "Вне программы"
          : `Глава ${String(item.place.chapter)}. ${chapterNames[item.place.chapter - 1] ?? ""}`;
    const group = groups.get(id) ?? { title, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups].map(([id, group]) => ({ id, ...group }));
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("ru") + value.slice(1);
}

function Meta({ item }: { readonly item: LibraryItem }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs font-semibold text-muted-foreground">
      <span>{formatLabels[item.format]}</span>
      <span aria-hidden="true">·</span>
      <span>{lengthLabel(item)}</span>
      {isNew(item) ? (
        <span className="rounded-full bg-accent-bright/15 px-1.5 py-0.5 text-[0.7rem] text-foreground">
          Новое
        </span>
      ) : null}
    </span>
  );
}

function Origin({ item }: { readonly item: LibraryItem }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {item.read === true ? (
        <Check aria-label="Изучено" className="size-3.5 text-foreground" />
      ) : null}
      {placeLabel(item)}
    </span>
  );
}

function Cover({
  item,
  className,
  label = false,
}: {
  readonly item: LibraryItem;
  readonly className: string;
  readonly label?: boolean;
}) {
  return (
    <span className="relative block">
      <ContentCoverImage
        alt=""
        className={className}
        cover={item.cover}
        fallbackKind={
          item.format === "video"
            ? "video"
            : item.format === "note"
              ? "note"
              : "material"
        }
        fallbackSeed={item.slug}
        {...(label && item.place !== null
          ? {
              fallbackLabel: `${String(item.place.chapter)}.${String(item.place.lesson)}`,
            }
          : {})}
      />
      {item.format === "video" ? (
        <span className="absolute right-2 bottom-2 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums">
          {lengthLabel(item)}
        </span>
      ) : null}
    </span>
  );
}

function CardLink({
  item,
  children,
  className,
}: {
  readonly item: LibraryItem;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <a
      className={cn(
        "group/card relative flex min-w-0 flex-col text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className,
      )}
      href={`#${item.slug}`}
      onClick={(event) => {
        event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

/** A: every card has a 16:9 picture; a missing cover becomes the generated pattern. */
function EvenGrid({ groups }: { readonly groups: readonly Group[] }) {
  return groups.map((group) => (
    <GroupSection key={group.id} group={group}>
      <ul className="grid grid-cols-1 gap-x-5 gap-y-7 @min-[34rem]/library:grid-cols-2 @min-[54rem]/library:grid-cols-3">
        {group.items.map((item) => (
          <li className="min-w-0" key={item.slug}>
            <CardLink item={item} className="h-full gap-3">
              <Cover item={item} className="aspect-video w-full rounded-2xl" />
              <Meta item={item} />
              <h3 className="line-clamp-2 text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                {item.title}
              </h3>
              <p className="line-clamp-2 text-sm leading-5 text-body-muted">
                {item.summary}
              </p>
              <span className="mt-auto pt-1">
                <Origin item={item} />
              </span>
            </CardLink>
          </li>
        ))}
      </ul>
    </GroupSection>
  ));
}

/** A2: the owner's pick of A, with format, length, novelty and progress drawn on the picture. */
function QuietGrid({ groups }: { readonly groups: readonly Group[] }) {
  return groups.map((group) => (
    <GroupSection key={group.id} group={group}>
      <ul className="grid grid-cols-1 gap-x-5 gap-y-7 @min-[34rem]/library:grid-cols-2 @min-[54rem]/library:grid-cols-3">
        {group.items.map((item) => (
          <li className="min-w-0" key={item.slug}>
            <CardLink item={item} className="h-full gap-2.5">
              <VisualCover item={item} />
              <h3 className="mt-0.5 line-clamp-2 text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                {item.title}
              </h3>
              <p className="line-clamp-2 text-sm leading-5 text-body-muted">
                {item.summary}
              </p>
              {item.place === null ? null : (
                <span className="mt-auto text-xs text-muted-foreground">
                  Глава {item.place.chapter} · урок {item.place.lesson}
                </span>
              )}
            </CardLink>
          </li>
        ))}
      </ul>
    </GroupSection>
  ));
}

function VisualCover({ item }: { readonly item: LibraryItem }) {
  const Icon = item.format === "video" ? Play : formatIcons[item.format];
  return (
    <span className="relative block">
      <ContentCoverImage
        alt=""
        className="aspect-video w-full rounded-2xl"
        cover={item.cover}
        fallbackKind={
          item.format === "video"
            ? "video"
            : item.format === "note"
              ? "note"
              : "material"
        }
        fallbackSeed={item.slug}
      />
      {item.read === true ? (
        <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-white/90 text-foreground shadow-sm">
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          <span className="sr-only">Изучено</span>
        </span>
      ) : null}
      <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums">
        <Icon
          aria-hidden="true"
          className="size-3"
          {...(item.format === "video" ? { fill: "currentColor" } : {})}
        />
        <span className="sr-only">{formatLabels[item.format]}, </span>
        {lengthLabel(item)}
      </span>
    </span>
  );
}

/** B: videos keep their pictures on one shelf; texts sit on another without pictures. */
function Shelves({
  shown,
  sort,
}: {
  readonly shown: readonly LibraryItem[];
  readonly sort: Sort;
}) {
  const ordered = groupItems(shown, sort).flatMap((group) => group.items);
  const videos = ordered.filter((item) => item.format === "video");
  const texts = ordered.filter((item) => item.format !== "video");
  return (
    <>
      {videos.length === 0 ? null : (
        <GroupSection group={{ id: "videos", title: "Видео", items: videos }}>
          <ul className="grid grid-cols-1 gap-x-5 gap-y-6 @min-[34rem]/library:grid-cols-2 @min-[54rem]/library:grid-cols-3">
            {videos.map((item) => (
              <li className="min-w-0" key={item.slug}>
                <CardLink item={item} className="h-full gap-2.5">
                  <Cover
                    item={item}
                    className="aspect-video w-full rounded-2xl"
                  />
                  <h3 className="line-clamp-2 text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                    {item.title}
                  </h3>
                  <span className="mt-auto">
                    <Origin item={item} />
                  </span>
                </CardLink>
              </li>
            ))}
          </ul>
        </GroupSection>
      )}
      {texts.length === 0 ? null : (
        <GroupSection
          group={{ id: "texts", title: "Гайды и заметки", items: texts }}
        >
          <ul className="grid grid-cols-1 gap-3 @min-[34rem]/library:grid-cols-2 @min-[54rem]/library:grid-cols-3">
            {texts.map((item) => {
              const Icon = formatIcons[item.format];
              return (
                <li className="min-w-0" key={item.slug}>
                  <CardLink
                    item={item}
                    className="h-full gap-2 rounded-2xl border border-black/8 bg-muted/55 p-4 transition-colors hover:bg-white"
                  >
                    <span className="flex items-center gap-2">
                      <Icon
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                      <Meta item={item} />
                    </span>
                    <h3 className="line-clamp-2 text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                      {item.title}
                    </h3>
                    <p className="line-clamp-3 text-sm leading-5 text-body-muted">
                      {item.summary}
                    </p>
                    <span className="mt-auto pt-1">
                      <Origin item={item} />
                    </span>
                  </CardLink>
                </li>
              );
            })}
          </ul>
        </GroupSection>
      )}
    </>
  );
}

/** C: columns without rows; a cover keeps its own shape, text without a cover reads as a quote. */
function Mosaic({ groups }: { readonly groups: readonly Group[] }) {
  return groups.map((group) => (
    <GroupSection key={group.id} group={group}>
      <ul className={styles["mosaic"]}>
        {group.items.map((item) => (
          <li className={styles["mosaicItem"]} key={item.slug}>
            {item.cover === null && item.format !== "video" ? (
              <CardLink
                item={item}
                className="gap-2.5 rounded-2xl bg-secondary p-4 transition-colors hover:bg-muted"
              >
                <Meta item={item} />
                <h3 className="text-lg leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                  {item.title}
                </h3>
                <p className="text-sm leading-6 text-body-muted">
                  {item.summary}
                </p>
                <Origin item={item} />
              </CardLink>
            ) : (
              <CardLink item={item} className="gap-2.5">
                <Cover
                  item={item}
                  className={cn(
                    "w-full rounded-2xl",
                    item.format === "video" ? "aspect-video" : "aspect-[4/3]",
                  )}
                />
                <Meta item={item} />
                <h3 className="text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                  {item.title}
                </h3>
                <Origin item={item} />
              </CardLink>
            )}
          </li>
        ))}
      </ul>
    </GroupSection>
  ));
}

/** D: equal dense tiles with a square thumbnail; programme lessons show their number. */
function Tiles({ groups }: { readonly groups: readonly Group[] }) {
  return groups.map((group) => (
    <GroupSection key={group.id} group={group}>
      <ul className="grid grid-cols-1 gap-2.5 @min-[34rem]/library:grid-cols-2 @min-[60rem]/library:grid-cols-3">
        {group.items.map((item) => (
          <li className="min-w-0" key={item.slug}>
            <CardLink
              item={item}
              className="h-full flex-row items-center gap-3 rounded-2xl border border-black/8 bg-muted/55 p-2.5 transition-colors hover:bg-white"
            >
              <span className="w-20 shrink-0">
                <Cover
                  item={item}
                  label
                  className="aspect-square w-20 rounded-xl"
                />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <Meta item={item} />
                <h3 className="line-clamp-2 text-sm leading-5 font-semibold tracking-[-0.02em] group-hover/card:text-action">
                  {item.title}
                </h3>
                <Origin item={item} />
              </span>
            </CardLink>
          </li>
        ))}
      </ul>
    </GroupSection>
  ));
}

function GroupSection({
  group,
  children,
}: {
  readonly group: Group;
  readonly children: ReactNode;
}) {
  return (
    <section className="mt-7 first:mt-4" aria-label={group.title}>
      <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-muted-foreground">
        <span className="text-foreground">{group.title}</span>
        <span className="tabular-nums">{group.items.length}</span>
      </h3>
      {children}
    </section>
  );
}

function readVariant(): number {
  const value = new URLSearchParams(location.search).get("variant");
  const index = variants.findIndex((entry) => entry.id === value);
  return index < 0 ? 0 : index;
}

function Comparison({ initialVariant }: { readonly initialVariant?: number }) {
  const [variant, setVariant] = useState(() => initialVariant ?? readVariant());
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<Format | "">("");
  const [scope, setScope] = useState<"" | "programme" | "extra">("");
  const [sort, setSort] = useState<Sort>("new");
  function changeVariant(value: number) {
    const next = (value + variants.length) % variants.length;
    setVariant(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", variants[next]?.id ?? "A");
    history.replaceState(null, "", url);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input"))
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        changeVariant(variant + (event.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  });
  const needle = query.trim().toLocaleLowerCase("ru");
  const shown = items.filter(
    (item) =>
      (needle === "" ||
        `${item.title} ${item.summary}`
          .toLocaleLowerCase("ru")
          .includes(needle)) &&
      (format === "" || item.format === format) &&
      (scope === "" || (scope === "programme") === (item.place !== null)),
  );
  const groups = groupItems(shown, sort);
  const current = variants[variant] ?? variants[0];
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9 sm:px-3.5 sm:text-sm",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:text-foreground",
    );
  return (
    <div className="programme-frame mx-auto px-4 pt-6 pb-28 sm:px-6">
      <aside className="programme-sidebar">
        <nav aria-label="Разделы продукта" className="programme-sidebar-inner">
          <ul className="programme-sidebar-parts">
            <li>
              <button type="button">
                <List aria-hidden="true" />
                <span>Программа</span>
                <small>11</small>
              </button>
            </li>
            <li>
              <button type="button" data-current="true" aria-current="true">
                <LayoutGrid aria-hidden="true" />
                <span>Материалы</span>
                <small>{items.length}</small>
              </button>
            </li>
          </ul>
        </nav>
      </aside>
      <div
        className="@container/library min-w-0"
        data-prototype-variant={current.id}
      >
        <h2 className="text-lg font-semibold tracking-[-0.02em] sm:text-xl">
          Материалы
        </h2>
        <label className="mt-3 flex min-h-10 items-center gap-2 rounded-xl bg-muted px-3 sm:mt-4 sm:min-h-11">
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">Поиск по материалам курса</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-sm placeholder:text-muted-foreground sm:placeholder:text-base"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder="Найти материал"
            type="search"
            value={query}
          />
        </label>
        <div className="public-horizontal-rail -mx-4 mt-2.5 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:mt-3 sm:flex-wrap sm:overflow-visible sm:px-0">
          <div
            aria-label="Формат"
            className="flex shrink-0 gap-1.5"
            role="group"
          >
            {(
              [
                ["", "Все"],
                ["video", "Видео"],
                ["guide", "Гайды"],
                ["note", "Заметки"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={format === value}
                className={chip(format === value)}
                key={value}
                onClick={() => {
                  setFormat(value);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
          <div
            aria-label="Откуда"
            className="flex shrink-0 gap-1.5"
            role="group"
          >
            {(
              [
                ["programme", "Из программы"],
                ["extra", "Вне программы"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={scope === value}
                className={chip(scope === value)}
                key={value}
                onClick={() => {
                  setScope(scope === value ? "" : value);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 sm:mt-4">
          <p
            aria-live="polite"
            className="text-xs text-muted-foreground sm:text-sm"
          >
            {shown.length === items.length
              ? `${String(items.length)} материалов`
              : `Найдено: ${String(shown.length)}`}
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
            <span>Порядок</span>
            <select
              className="rounded-lg bg-muted px-2 py-1 font-semibold text-foreground"
              onChange={(event) => {
                setSort(
                  event.currentTarget.value === "programme"
                    ? "programme"
                    : "new",
                );
              }}
              value={sort}
            >
              <option value="new">Сначала новые</option>
              <option value="programme">По программе</option>
            </select>
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="py-10 text-sm text-muted-foreground">
            Ничего не нашлось. Попробуй другой запрос или сними фильтры.
          </p>
        ) : current.id === "A2" ? (
          <QuietGrid groups={groups} />
        ) : current.id === "A" ? (
          <EvenGrid groups={groups} />
        ) : current.id === "B" ? (
          <Shelves shown={shown} sort={sort} />
        ) : current.id === "C" ? (
          <Mosaic groups={groups} />
        ) : (
          <Tiles groups={groups} />
        )}
      </div>
      <nav className={styles["switcher"]} aria-label="Варианты каталога">
        <button
          aria-label="Предыдущий вариант"
          onClick={() => {
            changeVariant(variant - 1);
          }}
          type="button"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <small>
            Прототип · {current.id} · {variant + 1} из {variants.length}
          </small>
          <strong>{current.name}</strong>
          <span>{current.note}</span>
        </div>
        <button
          aria-label="Следующий вариант"
          onClick={() => {
            changeVariant(variant + 1);
          }}
          type="button"
        >
          <ArrowRight size={18} />
        </button>
      </nav>
    </div>
  );
}

const environment = publicPageEnvironment(
  "/products/ai-engineering/programme",
  {
    account: "authenticated",
  },
);
const meta = {
  ...environment,
  title: "Prototypes/Material Catalog Layouts",
  component: Comparison,
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {};
export const CompareMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
