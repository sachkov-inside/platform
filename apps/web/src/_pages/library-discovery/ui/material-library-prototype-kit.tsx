import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FileText,
  LayoutGrid,
  List,
  type LucideIcon,
  NotebookPen,
  Play,
  Search,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ContentCover } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import "./product-programme-view.css";
import styles from "./material-library-sections.prototype.module.css";

// Throwaway: fixture data, the host page frame and the variant switcher shared by the Product
// «Материалы» library prototypes. Fixture data only; production MaterialCatalog stays unchanged.

export type Format = "video" | "guide" | "note";
export type TopicId =
  "base" | "spec" | "design" | "review" | "delivery" | "setup";

export interface Item {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly format: Format;
  readonly cover: ContentCover | null;
  /** Video length in seconds. */
  readonly seconds?: number;
  readonly publishedAt: string;
  readonly place: { readonly chapter: number; readonly lesson: number } | null;
  readonly topic: TopicId;
  readonly tags: readonly string[];
  readonly read?: boolean;
}

export const chapterNames = [
  "Основа разработки с агентами",
  "Цикл разработки и ревью",
  "Поставка и эксплуатация",
] as const;

export const topics: readonly {
  readonly id: TopicId;
  readonly name: string;
  readonly summary: string;
}[] = [
  {
    id: "base",
    name: "Основа работы с агентом",
    summary: "Контекст, инструкции, скиллы и первые шаги в проекте.",
  },
  {
    id: "spec",
    name: "Проектирование и спецификации",
    summary:
      "Как продумать проект с агентом до кода: grilling, карта вопросов, спецификация.",
  },
  {
    id: "design",
    name: "Дизайн с агентами",
    summary:
      "Макеты, прототипы и интерфейс: как получать от агента дизайн, который можно показать.",
  },
  {
    id: "review",
    name: "Ревью и замечания",
    summary:
      "Как проверять работу агента и сохранять замечания, чтобы они не терялись.",
  },
  {
    id: "delivery",
    name: "Поставка и CI",
    summary: "Проверки, релизы и выкладка с агентом.",
  },
  {
    id: "setup",
    name: "Модели и окружение",
    summary: "Какие модели, клиенты и MCP стоят в рабочем окружении.",
  },
];

export function cover(index: number, wide: boolean): ContentCover {
  return {
    coverId: `27100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    renditions: [{ width: 960, height: wide ? 540 : 960 }],
  };
}

export const items: readonly Item[] = [
  {
    slug: "kak-ustroen-kurs",
    title: "Как устроен курс",
    summary:
      "Из чего состоит курс, как проходить главы и где задавать вопросы.",
    format: "guide",
    cover: null,
    publishedAt: "2026-09-02",
    place: { chapter: 1, lesson: 1 },
    topic: "base",
    tags: [],
    read: true,
  },
  {
    slug: "vybor-agenta",
    title: "Выбор агента и модели",
    summary:
      "Сравниваем агентов и модели по задачам, цене и контролю над окружением.",
    format: "guide",
    cover: cover(8, false),
    publishedAt: "2026-09-04",
    place: { chapter: 1, lesson: 2 },
    topic: "setup",
    tags: ["модели"],
    read: true,
  },
  {
    slug: "kontekst-instrumenty",
    title: "Контекст, инструменты и harness агента",
    summary: "Что агент видит, чем действует и как окружение меняет результат.",
    format: "video",
    cover: cover(5, true),
    seconds: 1124,
    publishedAt: "2026-09-08",
    place: { chapter: 1, lesson: 3 },
    topic: "base",
    tags: ["контекст"],
    read: true,
  },
  {
    slug: "instrukcii-skilly",
    title: "Инструкции, скиллы и рабочее окружение",
    summary:
      "Пишем короткий AGENTS.md, подключаем скиллы и проверяем, что агент их применяет.",
    format: "guide",
    cover: null,
    publishedAt: "2026-09-12",
    place: { chapter: 1, lesson: 4 },
    topic: "base",
    tags: ["AGENTS.md", "скиллы"],
  },
  {
    slug: "nachinaem-rabotu",
    title: "Начинаем работу с агентом в проекте",
    summary:
      "Видео, в котором я с агентом создаю проект, публикую его на GitHub и пишу короткий AGENTS.md.",
    format: "video",
    cover: cover(6, true),
    seconds: 871,
    publishedAt: "2026-09-18",
    place: { chapter: 1, lesson: 5 },
    topic: "base",
    tags: ["AGENTS.md", "скиллы"],
  },
  {
    slug: "specifikaciya",
    title: "Спецификация: от идеи до задач",
    summary:
      "Как записать решение так, чтобы агент делал по нему задачи без догадок.",
    format: "guide",
    cover: null,
    publishedAt: "2026-10-02",
    place: { chapter: 1, lesson: 6 },
    topic: "spec",
    tags: ["спецификации"],
  },
  {
    slug: "grilling",
    title: "Проектирование с агентом через grilling",
    summary:
      "Видео, в котором я продумываю проект с агентом до кода. Строю карту вопросов через wayfinder.",
    format: "video",
    cover: null,
    seconds: 1420,
    publishedAt: "2026-10-12",
    place: { chapter: 1, lesson: 7 },
    topic: "spec",
    tags: ["спецификации", "grilling"],
  },
  {
    slug: "praktika",
    title: "Практика: от спецификации к работающему приложению",
    summary:
      "Реализация согласованной основы с агентом, проверка запуска, правило слияния и завершение.",
    format: "video",
    cover: null,
    seconds: 2075,
    publishedAt: "2026-10-20",
    place: { chapter: 1, lesson: 8 },
    topic: "spec",
    tags: ["спецификации", "практика"],
  },
  {
    slug: "zamechaniya",
    title: "Куда и как сохранять замечания к работе агента",
    summary:
      "Как сохранять замечания к работе агента и подключать их при реализации или ревью.",
    format: "guide",
    cover: null,
    publishedAt: "2026-11-06",
    place: { chapter: 2, lesson: 1 },
    topic: "review",
    tags: ["ревью", "AGENTS.md"],
  },
  {
    slug: "cikl-razrabotki",
    title: "Цикл разработки: от обсуждения до pull request",
    summary:
      "Задача, ветка, проверки, ревью и merge в одном повторяемом цикле.",
    format: "guide",
    cover: null,
    publishedAt: "2026-10-10",
    place: { chapter: 2, lesson: 2 },
    topic: "review",
    tags: ["ревью", "CI"],
  },
  {
    slug: "testirovanie",
    title: "Тестирование, проверки архитектуры и CI",
    summary: "Какие проверки держат агента в рамках и как собрать их в CI.",
    format: "guide",
    cover: cover(9, false),
    publishedAt: "2026-10-06",
    place: { chapter: 3, lesson: 1 },
    topic: "delivery",
    tags: ["CI", "тесты"],
  },
  {
    slug: "dizayn-s-agentom",
    title: "Дизайн с агентом: от референсов до макета",
    summary:
      "Как объяснить агенту визуальное направление, собрать макет и не получить типовой интерфейс.",
    format: "guide",
    cover: cover(10, false),
    publishedAt: "2026-11-09",
    place: null,
    topic: "design",
    tags: ["дизайн", "прототипы"],
  },
  {
    slug: "efir-dizayn",
    title: "Эфир: разбираем интерфейсы участников",
    summary:
      "Запись эфира: смотрим четыре интерфейса и правим их вместе с агентом.",
    format: "video",
    cover: null,
    seconds: 2890,
    publishedAt: "2026-11-05",
    place: null,
    topic: "design",
    tags: ["дизайн", "эфир"],
  },
  {
    slug: "prototipy-ui",
    title: "Несколько прототипов интерфейса за один запрос",
    summary:
      "Агент собирает разные варианты страницы, а я выбираю между ними в браузере.",
    format: "video",
    cover: cover(7, true),
    seconds: 1105,
    publishedAt: "2026-11-02",
    place: null,
    topic: "design",
    tags: ["дизайн", "прототипы", "Storybook"],
    read: true,
  },
  {
    slug: "zametka-skrinshoty",
    title: "Скриншоты как обратная связь агенту",
    summary:
      "Короткая заметка: что писать рядом со скриншотом, чтобы агент понял правку.",
    format: "note",
    cover: null,
    publishedAt: "2026-10-30",
    place: null,
    topic: "design",
    tags: ["дизайн", "ревью"],
  },
  {
    slug: "dizayn-sistema",
    title: "Дизайн-система, которую агент соблюдает",
    summary:
      "Токены, каталог компонентов и проверки, которые не дают агенту рисовать своё.",
    format: "guide",
    cover: null,
    publishedAt: "2026-10-24",
    place: null,
    topic: "design",
    tags: ["дизайн", "Storybook"],
  },
  {
    slug: "sushchestvuyushchiy-proekt",
    title: "Как работать с агентом в существующем проекте",
    summary:
      "Как изучить действующий проект и постепенно настроить инструкции, скиллы и проверки.",
    format: "guide",
    cover: null,
    publishedAt: "2026-10-28",
    place: null,
    topic: "base",
    tags: ["AGENTS.md", "скиллы"],
  },
  {
    slug: "avtorizaciya-mcp",
    title: "Авторизация MCP и доступ агента",
    summary:
      "Проверяем текущие полномочия при каждом вызове и отдельно отзываем подключения.",
    format: "guide",
    cover: cover(11, false),
    publishedAt: "2026-10-28",
    place: null,
    topic: "setup",
    tags: ["MCP"],
  },
  {
    slug: "zametka-modeli",
    title: "Какие модели я использую сейчас",
    summary: "Короткая заметка: что стоит в моём окружении и почему.",
    format: "note",
    cover: null,
    publishedAt: "2026-10-26",
    place: null,
    topic: "setup",
    tags: ["модели"],
  },
  {
    slug: "razbor-efira",
    title: "Эфир: ревью проектов участников",
    summary:
      "Запись эфира, где разбираем три проекта и типичные ошибки в инструкциях.",
    format: "video",
    cover: null,
    seconds: 3260,
    publishedAt: "2026-10-22",
    place: null,
    topic: "review",
    tags: ["ревью", "эфир"],
  },
  {
    slug: "zametka-revyu",
    title: "Почему ревью делает отдельный агент",
    summary: "Свежий контекст замечает то, что пропустил автор изменения.",
    format: "note",
    cover: null,
    publishedAt: "2026-10-17",
    place: null,
    topic: "review",
    tags: ["ревью"],
  },
  {
    slug: "demo-relizy",
    title: "Демо: выпуск релиза через агента",
    summary: "Агент готовит релиз, а я проверяю каждый шаг перед выкладкой.",
    format: "video",
    cover: cover(5, true),
    seconds: 642,
    publishedAt: "2026-09-29",
    place: null,
    topic: "delivery",
    tags: ["CI", "практика"],
  },
];

export interface Collection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly slugs: readonly string[];
}

/** Author-curated ordered sets; one Material may sit in several. */
export const collections: readonly Collection[] = [
  {
    id: "design",
    title: "Дизайн с агентами",
    summary:
      "От референсов и макета до проверенного интерфейса. Лучше смотреть по порядку.",
    slugs: [
      "dizayn-s-agentom",
      "prototipy-ui",
      "dizayn-sistema",
      "zametka-skrinshoty",
      "efir-dizayn",
    ],
  },
  {
    id: "own-project",
    title: "С чего начать в своём проекте",
    summary:
      "Четыре материала, после которых агент работает в твоём репозитории по правилам.",
    slugs: [
      "nachinaem-rabotu",
      "instrukcii-skilly",
      "sushchestvuyushchiy-proekt",
      "zamechaniya",
    ],
  },
  {
    id: "practice",
    title: "Практика целиком: от идеи до релиза",
    summary: "Один проект от первого обсуждения до выкладки, шаг за шагом.",
    slugs: [
      "grilling",
      "specifikaciya",
      "praktika",
      "testirovanie",
      "demo-relizy",
    ],
  },
  {
    id: "streams",
    title: "Записи эфиров",
    summary: "Разборы проектов и интерфейсов участников.",
    slugs: ["efir-dizayn", "razbor-efira"],
  },
];

export const formatLabels: Readonly<Record<Format, string>> = {
  video: "Видео",
  guide: "Гайд",
  note: "Заметка",
};
export const formatIcons: Readonly<Record<Format, LucideIcon>> = {
  video: Play,
  guide: FileText,
  note: NotebookPen,
};
export const formatChips = [
  ["", "Все"],
  ["video", "Видео"],
  ["guide", "Гайды"],
  ["note", "Заметки"],
] as const;

/** The fixture's «today» is 2026-11-11; the last seven days count as new. */
export const NEW_SINCE = "2026-11-04";

export function isNew(item: Item): boolean {
  return item.publishedAt >= NEW_SINCE;
}

export function bySlug(slug: string): Item | undefined {
  return items.find((item) => item.slug === slug);
}

export function collectionItems(collection: Collection): readonly Item[] {
  return collection.slugs.flatMap((slug) => bySlug(slug) ?? []);
}

export function topicName(id: TopicId): string {
  return topics.find((topic) => topic.id === id)?.name ?? "";
}

export function plural(
  count: number,
  forms: readonly [string, string, string],
): string {
  const tens = count % 100;
  const ones = count % 10;
  const form =
    tens >= 11 && tens <= 14
      ? forms[2]
      : ones === 1
        ? forms[0]
        : ones >= 2 && ones <= 4
          ? forms[1]
          : forms[2];
  return `${String(count)} ${form}`;
}

export const materialForms = ["материал", "материала", "материалов"] as const;

export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes >= 60
    ? `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, "0")}:${rest}`
    : `${String(minutes)}:${rest}`;
}

export function videoTotal(list: readonly Item[]): string | null {
  const minutes = Math.round(
    list.reduce((sum, item) => sum + (item.seconds ?? 0), 0) / 60,
  );
  if (minutes === 0) return null;
  return minutes >= 60
    ? `${String(Math.floor(minutes / 60))} ч ${String(minutes % 60)} мин видео`
    : `${String(minutes)} мин видео`;
}

export function placeLabel(item: Item): string | undefined {
  return item.place === null
    ? undefined
    : `Глава ${String(item.place.chapter)} · урок ${String(item.place.lesson)}`;
}

export function matches(item: Item, needle: string): boolean {
  return (
    needle === "" ||
    `${item.title} ${item.summary} ${item.tags.join(" ")} ${topicName(item.topic)}`
      .toLocaleLowerCase("ru")
      .includes(needle)
  );
}

export function newestFirst(list: readonly Item[]): Item[] {
  return [...list].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt),
  );
}

export function firstDifference(...differences: readonly number[]): number {
  return differences.find((difference) => difference !== 0) ?? 0;
}

export function programmeFirst(list: readonly Item[]): Item[] {
  return [...list].sort((left, right) =>
    firstDifference(
      (left.place?.chapter ?? 99) - (right.place?.chapter ?? 99),
      (left.place?.lesson ?? 0) - (right.place?.lesson ?? 0),
      right.publishedAt.localeCompare(left.publishedAt),
    ),
  );
}

export const monthFormat = new Intl.DateTimeFormat("ru", {
  month: "long",
  year: "numeric",
});

export interface Group {
  readonly id: string;
  readonly title: string;
  readonly items: readonly Item[];
}

/** The accepted production grouping: «Новое», then months. */
export function monthGroups(list: readonly Item[]): Group[] {
  const groups = new Map<string, { title: string; items: Item[] }>();
  for (const item of newestFirst(list)) {
    const month = monthFormat.format(new Date(`${item.publishedAt}T12:00:00`));
    const id = isNew(item) ? "new" : item.publishedAt.slice(0, 7);
    const group = groups.get(id) ?? {
      title: isNew(item)
        ? "Новое"
        : month.charAt(0).toLocaleUpperCase("ru") + month.slice(1),
      items: [],
    };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups].map(([id, group]) => ({ id, ...group }));
}

export const chipClass = (active: boolean) =>
  cn(
    "inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9 sm:px-3.5 sm:text-sm",
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted text-muted-foreground hover:text-foreground",
  );
// ───────────────────────── shared pieces of the host page ─────────────────────────

export function Frame({
  variant,
  sidebar,
  children,
}: {
  readonly variant: string;
  readonly sidebar?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="programme-frame mx-auto px-4 pt-6 pb-40 sm:px-6">
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
              <button aria-current="true" data-current="true" type="button">
                <LayoutGrid aria-hidden="true" />
                <span>Материалы</span>
                <small>{items.length}</small>
              </button>
            </li>
          </ul>
          {sidebar}
        </nav>
      </aside>
      <div
        className="@container/library min-w-0"
        data-prototype-variant={variant}
      >
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Главная <ChevronRight aria-hidden="true" className="size-3.5" />
          AI Engineering{" "}
          <ChevronRight aria-hidden="true" className="size-3.5" />
          <span className="text-foreground">Программа</span>
        </p>
        <header className="mt-4 mb-6 rounded-3xl bg-muted/60 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground text-sm font-bold text-background">
              AI
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
                AI Engineering
              </h1>
              <p className="text-sm text-muted-foreground">
                3 главы · {plural(items.length, materialForms)} · всё открыто
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Изучено 3 из 11</span>
              <span>27%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-border">
              <div className="h-full w-[27%] rounded-full bg-action" />
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

export function PartHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h2 className="text-lg font-semibold tracking-[-0.02em] sm:text-xl">
      {children}
    </h2>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Найти материал",
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <label className="mt-3 flex min-h-10 items-center gap-2 rounded-xl bg-muted px-3 sm:mt-4 sm:min-h-11">
      <Search
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="sr-only">Поиск по материалам курса</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-sm placeholder:text-muted-foreground sm:placeholder:text-base"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  );
}

export function fallbackKind(item: Item): "video" | "note" | "material" {
  return item.format === "guide" ? "material" : item.format;
}

export const stay = (event: { preventDefault: () => void }) => {
  event.preventDefault();
};

export function Empty() {
  return (
    <p className="py-10 text-sm leading-6 text-muted-foreground">
      Ничего не нашлось. Попробуй другой запрос или сними фильтры.
    </p>
  );
}

// ───────────────────────── variant switcher ─────────────────────────

export interface PrototypeVariant {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly render: () => ReactNode;
}

function readVariant(variants: readonly PrototypeVariant[]): number {
  const value = new URLSearchParams(location.search).get("variant");
  const index = variants.findIndex((entry) => entry.id === value);
  return index < 0 ? 0 : index;
}

/** The current variant plus the floating bar: arrows and ←/→ keys cycle, `?variant=` keeps it. */
export function VariantComparison({
  initialVariant,
  label,
  variants,
}: {
  readonly initialVariant?: string;
  readonly label: string;
  readonly variants: readonly PrototypeVariant[];
}) {
  const [variant, setVariant] = useState(() =>
    initialVariant === undefined
      ? readVariant(variants)
      : Math.max(
          0,
          variants.findIndex((entry) => entry.id === initialVariant),
        ),
  );
  function changeVariant(value: number) {
    const next = (value + variants.length) % variants.length;
    setVariant(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", variants[next]?.id ?? "");
    history.replaceState(null, "", url);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, select, textarea, [contenteditable]")
      )
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
  const current = variants[variant] ?? variants[0];
  if (current === undefined) return null;
  return (
    <>
      <div key={current.id}>{current.render()}</div>
      <nav aria-label={label} className={styles["switcher"]}>
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
    </>
  );
}

// ───────────────────────── the shelves page picked in round 1 ─────────────────────────

export type Kind = "all" | "video" | "text";
/** Where a list is shown: it decides which single fact may accompany a title. */
export type Place = "new" | "topic" | "search";

export interface Look {
  /** Topic blocks stand in two columns on a wide screen. */
  readonly columns?: boolean;
  /** A shelf on the overview: a short preview of the topic. */
  readonly preview: (list: readonly Item[], place: Place) => ReactNode;
  /** An opened topic or search results: everything. */
  readonly full: (list: readonly Item[], place: Place) => ReactNode;
}

export const isVideo = (item: Item) => item.format === "video";

export function noteOf(item: Item, place: Place): string | undefined {
  return place === "topic" ? placeLabel(item) : topicName(item.topic);
}

export const titleClass =
  "line-clamp-2 text-[0.9375rem] leading-5 font-semibold tracking-[-0.01em] group-hover/card:text-action";
export const linkClass =
  "group/card text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const railClass =
  "public-horizontal-rail -mx-4 grid snap-x scroll-px-4 grid-flow-col auto-cols-[62%] gap-3 overflow-x-auto px-4 sm:mx-0 sm:scroll-px-0 sm:px-0 @min-[34rem]/library:auto-cols-[calc((100%-2rem)/3)] @min-[34rem]/library:gap-4";
export const gridClass =
  "grid grid-cols-2 gap-x-3 gap-y-5 @min-[34rem]/library:grid-cols-3 @min-[34rem]/library:gap-x-4";

export function ShelvesPage({
  look,
  variant,
}: {
  readonly look: Look;
  readonly variant: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [topic, setTopic] = useState<TopicId | null>(null);
  const needle = query.trim().toLocaleLowerCase("ru");
  const pool = items.filter(
    (item) => kind === "all" || (kind === "video") === isVideo(item),
  );
  const found = pool.filter((item) => matches(item, needle));
  const opened = topics.find((entry) => entry.id === topic);
  const fresh = newestFirst(pool.filter(isNew));
  return (
    <Frame variant={variant}>
      <div className="flex items-center justify-between gap-3">
        <PartHeading>Материалы</PartHeading>
        <div
          aria-label="Что показать"
          className="inline-flex rounded-full bg-muted p-0.5"
          role="group"
        >
          {(
            [
              ["all", "Всё"],
              ["video", "Видео"],
              ["text", "Тексты"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={kind === value}
              className={cn(
                "min-h-8 rounded-full px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:text-sm",
                kind === value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => {
                setKind(value);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <SearchField onChange={setQuery} value={query} />
      <div
        aria-label="Тема"
        className="public-horizontal-rail -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:mt-3 sm:flex-wrap sm:px-0"
        role="group"
      >
        <button
          aria-pressed={topic === null}
          className={chipClass(topic === null)}
          onClick={() => {
            setTopic(null);
          }}
          type="button"
        >
          Все темы
        </button>
        {topics.map((entry) => (
          <button
            aria-pressed={topic === entry.id}
            className={chipClass(topic === entry.id)}
            key={entry.id}
            onClick={() => {
              setTopic(topic === entry.id ? null : entry.id);
            }}
            type="button"
          >
            {entry.name}
          </button>
        ))}
      </div>
      {needle !== "" ? (
        <section className="mt-6">
          <p className="mb-3 text-sm text-muted-foreground">
            Найдено: {plural(found.length, materialForms)}
          </p>
          {found.length === 0 ? (
            <Empty />
          ) : (
            look.full(newestFirst(found), "search")
          )}
        </section>
      ) : opened !== undefined ? (
        <section className="mt-6">
          <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
            {opened.name}
          </h3>
          <p className="mt-0.5 mb-3 text-sm leading-6 text-body-muted">
            {opened.summary}
          </p>
          {pool.some((item) => item.topic === opened.id) ? (
            look.full(
              programmeFirst(pool.filter((item) => item.topic === opened.id)),
              "topic",
            )
          ) : (
            <Empty />
          )}
        </section>
      ) : (
        <div
          className={cn(
            "mt-6 grid gap-y-8",
            look.columns === true
              ? "gap-x-8 @min-[40rem]/library:grid-cols-2"
              : "",
          )}
        >
          {fresh.length === 0 ? null : (
            <section className="min-w-0">
              <ShelfHeading title="Новое" />
              {look.preview(fresh, "new")}
            </section>
          )}
          {topics.map((entry) => {
            const list = programmeFirst(
              pool.filter((item) => item.topic === entry.id),
            );
            return list.length === 0 ? null : (
              <section className="min-w-0" key={entry.id}>
                <ShelfHeading
                  count={list.length}
                  onOpen={() => {
                    setTopic(entry.id);
                  }}
                  title={entry.name}
                />
                {look.preview(list, "topic")}
              </section>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

export function ShelfHeading({
  count,
  onOpen,
  title,
}: {
  readonly count?: number;
  readonly onOpen?: () => void;
  readonly title: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
        {title}
      </h3>
      {onOpen === undefined ? null : (
        <button
          className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-action hover:text-action-hover focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onOpen}
          type="button"
        >
          Все {count}
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
