"use client";

import { ChevronRight, Search } from "lucide-react";
import type { Route } from "next";
import { useState, useSyncExternalStore } from "react";

import {
  MaterialCard,
  materialPreviewHasVideo,
  type MaterialPreview,
} from "@/entities/material";
import {
  formatMaterialCount,
  type CatalogueTopic,
} from "@/features/library-discovery";
import { cn } from "@/shared/lib/utils";
import { catalogReaderReturnHref } from "@/shared/routing/material-reader";

/** Данные каталога: карточку рисует браузер только в открытом разделе. */
export interface CatalogEntry {
  readonly material: MaterialPreview;
  readonly inProgramme: boolean;
  /** First programme placement; null outside chapters, including a Product without chapters. */
  readonly place: CatalogPlace | null;
  /** Тема курса материала; null — автор ещё не поставил материал в тему. */
  readonly topicId: string | null;
}

/** Where a catalogue Material sits in the programme: chapter order and lesson within the chapter. */
export interface CatalogPlace {
  readonly chapter: number;
  readonly chapterName: string;
  readonly lesson: number;
}

export type CatalogKind = "all" | "video" | "text";
const kinds: readonly { readonly id: CatalogKind; readonly label: string }[] = [
  { id: "all", label: "Всё" },
  { id: "video", label: "Видео" },
  { id: "text", label: "Тексты" },
];

/** Свежими считаются материалы последней недели: они собраны в полку «Новое». */
const NEW_MATERIAL_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/**
 * Граница «Нового» — внешнее значение часов. Сервер и гидрация его не читают и полку не
 * показывают; браузер после гидрации берёт границу, округлённую до часа, чтобы снимок был стабилен.
 */
function readNewMaterialCutoff(): number {
  return Math.floor(Date.now() / HOUR_MS) * HOUR_MS - NEW_MATERIAL_PERIOD_MS;
}
const readServerNewMaterialCutoff = () => null;
const subscribeToClock = () => () => undefined;

const OTHER_SHELF_ID = "other";

interface Shelf {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly entries: readonly CatalogEntry[];
}

/**
 * Видом материала служит то же правило, по которому карточка рисует видео: урок курса с роликом
 * может иметь формат «Урок», и фильтр «Видео» показывает его вместе с форматом «Видео».
 */
export function catalogEntryMatchesKind(
  entry: CatalogEntry,
  kind: CatalogKind,
): boolean {
  return (
    kind === "all" ||
    (kind === "video") === materialPreviewHasVideo(entry.material)
  );
}

function newestFirst(entries: readonly CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((left, right) =>
    (right.material.publishedAt ?? "").localeCompare(
      left.material.publishedAt ?? "",
    ),
  );
}

/**
 * Порядок полки: программа продукта без глав своим порядком, затем уроки глав по главе и уроку,
 * затем материалы вне программы, сначала новые.
 */
function programmeFirst(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const position = new Map(entries.map((entry, index) => [entry, index]));
  const sections = ["programme", "chapters", "extra"] as const;
  const sectionOf = (entry: CatalogEntry) =>
    entry.place !== null
      ? "chapters"
      : entry.inProgramme
        ? "programme"
        : "extra";
  const section = (entry: CatalogEntry) => sections.indexOf(sectionOf(entry));
  return [...entries].sort((left, right) => {
    const differences = [
      section(left) - section(right),
      (left.place?.chapter ?? 0) - (right.place?.chapter ?? 0),
      (left.place?.lesson ?? 0) - (right.place?.lesson ?? 0),
      sectionOf(left) === "extra"
        ? (right.material.publishedAt ?? "").localeCompare(
            left.material.publishedAt ?? "",
          )
        : (position.get(left) ?? 0) - (position.get(right) ?? 0),
    ];
    return differences.find((difference) => difference !== 0) ?? 0;
  });
}

function placeLabel(place: CatalogPlace | null): string | undefined {
  return place === null
    ? undefined
    : `Глава ${String(place.chapter)} · урок ${String(place.lesson)}`;
}

/**
 * Каталог материалов продукта (#2022, прототип «Полки по темам», решения владельца 12.11.2026):
 * полка «Новое» за последнюю неделю, затем полки тем курса в авторском порядке и полка материалов
 * без темы. Свежий материал стоит и в «Новом», и на полке своей темы. Поиск заменяет полки одним
 * списком, кнопка темы или «Все N» открывает тему сеткой. Программа остаётся строгим порядком глав
 * в своём разделе.
 */
export function ProductMaterialCatalog({
  accessPending,
  currentHref,
  entries,
  topics,
}: {
  readonly accessPending: boolean;
  readonly currentHref: Route;
  readonly entries: readonly CatalogEntry[];
  readonly topics: readonly CatalogueTopic[];
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CatalogKind>("all");
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const newSince = useSyncExternalStore(
    subscribeToClock,
    readNewMaterialCutoff,
    readServerNewMaterialCutoff,
  );
  const topicName = new Map(topics.map((topic) => [topic.id, topic.name]));
  const pool = entries.filter((entry) => catalogEntryMatchesKind(entry, kind));
  const shelves: Shelf[] = [
    ...topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      summary: topic.summary,
      entries: programmeFirst(
        pool.filter((entry) => entry.topicId === topic.id),
      ),
    })),
    {
      id: OTHER_SHELF_ID,
      name: topics.length === 0 ? "Все материалы" : "Другие материалы",
      summary: "",
      entries: programmeFirst(
        pool.filter(
          (entry) => entry.topicId === null || !topicName.has(entry.topicId),
        ),
      ),
    },
  ].filter((shelf) => shelf.entries.length > 0);
  const needle = query.trim().toLocaleLowerCase("ru");
  const found =
    needle === ""
      ? []
      : newestFirst(
          pool.filter((entry) =>
            `${entry.material.title} ${entry.material.summary} ${
              entry.topicId === null ? "" : (topicName.get(entry.topicId) ?? "")
            }`
              .toLocaleLowerCase("ru")
              .includes(needle),
          ),
        );
  const fresh =
    newSince === null
      ? []
      : newestFirst(
          pool.filter(
            (entry) =>
              entry.material.publishedAt !== undefined &&
              Date.parse(entry.material.publishedAt) >= newSince,
          ),
        );
  // Фильтр вида может опустошить открытую тему: тогда страница снова показывает полки.
  const opened = shelves.find((shelf) => shelf.id === openTopic);
  const activeTopic = opened?.id ?? null;
  const card = (entry: CatalogEntry, annotation?: string) => (
    <MaterialCard
      accessPending={accessPending}
      headingLevel="h4"
      material={entry.material}
      readerContext={{ referenceView: true }}
      returnHref={catalogReaderReturnHref(currentHref, entry.material.slug)}
      {...(annotation === undefined ? {} : { rowAnnotation: annotation })}
      variant="library"
    />
  );
  const grid = (
    list: readonly CatalogEntry[],
    annotate: (entry: CatalogEntry) => string | undefined,
  ) => (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 @min-[34rem]/catalog:grid-cols-3 @min-[34rem]/catalog:gap-x-4">
      {list.map((entry) => (
        <li
          className="min-w-0"
          data-route-material={entry.material.slug}
          key={entry.material.slug}
        >
          {card(entry, annotate(entry))}
        </li>
      ))}
    </ul>
  );
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9 sm:px-3.5 sm:text-sm",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
    );
  return (
    <div className="@container/catalog" data-material-catalog>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.02em] sm:text-xl">
          Материалы
        </h2>
        <div
          aria-label="Что показать"
          className="inline-flex shrink-0 rounded-full bg-muted p-0.5"
          role="group"
        >
          {kinds.map((option) => (
            <button
              aria-pressed={kind === option.id}
              className={cn(
                "min-h-8 rounded-full px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:text-sm",
                kind === option.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
              key={option.id}
              onClick={() => {
                setKind(option.id);
                setOpenTopic(activeTopic);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {/* Поле 40 px, текст ввода 16 px, чтобы iPhone не увеличивал страницу (стандарт 09.10.2026). */}
      <label className="mt-3 flex min-h-10 items-center gap-2 rounded-xl bg-muted px-3 sm:mt-4 sm:min-h-11 sm:gap-2.5 sm:px-3.5">
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">Поиск по материалам курса</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-sm placeholder:text-muted-foreground sm:placeholder:text-base"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder="Найти материал"
          type="search"
          value={query}
        />
      </label>
      {topics.length === 0 ? null : (
        <div
          aria-label="Тема"
          className="public-horizontal-rail -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:mt-3 sm:flex-wrap sm:overflow-visible sm:px-0"
          role="group"
        >
          <button
            aria-pressed={activeTopic === null}
            className={chip(activeTopic === null)}
            onClick={() => {
              setOpenTopic(null);
            }}
            type="button"
          >
            Все темы
          </button>
          {shelves
            .filter((shelf) => shelf.id !== OTHER_SHELF_ID)
            .map((shelf) => (
              <button
                aria-pressed={activeTopic === shelf.id}
                className={chip(activeTopic === shelf.id)}
                key={shelf.id}
                onClick={() => {
                  setOpenTopic(activeTopic === shelf.id ? null : shelf.id);
                }}
                type="button"
              >
                {shelf.name}
              </button>
            ))}
        </div>
      )}
      <div aria-label="Материалы курса" role="region">
        {entries.length === 0 ? (
          <p className="py-10 text-sm leading-6 text-muted-foreground">
            Здесь появятся материалы курса.
          </p>
        ) : needle !== "" ? (
          <section className="mt-6">
            <h3
              aria-live="polite"
              className="mb-3 text-sm font-normal text-muted-foreground"
            >
              Найдено: {formatMaterialCount(found.length)}
            </h3>
            {found.length === 0 ? (
              <p className="py-6 text-sm leading-6 text-muted-foreground">
                Ничего не нашлось. Попробуй другой запрос или выбери «Всё».
              </p>
            ) : (
              grid(found, (entry) =>
                entry.topicId === null
                  ? undefined
                  : topicName.get(entry.topicId),
              )
            )}
          </section>
        ) : opened !== undefined ? (
          <section className="mt-6">
            <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
              {opened.name}
            </h3>
            {opened.summary.length === 0 ? null : (
              <p className="mt-0.5 text-sm leading-6 text-body-muted">
                {opened.summary}
              </p>
            )}
            <div className="mt-3">
              {grid(opened.entries, (entry) => placeLabel(entry.place))}
            </div>
          </section>
        ) : shelves.length === 0 && fresh.length === 0 ? (
          <p className="py-10 text-sm leading-6 text-muted-foreground">
            Здесь нет материалов этого вида. Выбери «Всё».
          </p>
        ) : (
          <div className="mt-6 grid gap-y-8">
            {fresh.length === 0 ? null : (
              <ShelfRow
                card={card}
                entries={fresh}
                returnTarget={false}
                title="Новое"
              />
            )}
            {shelves.map((shelf) =>
              topics.length === 0 ? (
                <section key={shelf.id}>
                  <h3 className="mb-3 text-base font-semibold tracking-[-0.02em] sm:text-lg">
                    {shelf.name}
                  </h3>
                  {grid(shelf.entries, (entry) => placeLabel(entry.place))}
                </section>
              ) : (
                <ShelfRow
                  card={card}
                  entries={shelf.entries}
                  key={shelf.id}
                  onOpen={() => {
                    setOpenTopic(shelf.id);
                  }}
                  title={shelf.name}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Полка: заголовок, «Все N» и ряд карточек, который листается вбок. */
function ShelfRow({
  card,
  entries,
  onOpen,
  returnTarget = true,
  title,
}: {
  readonly card: (entry: CatalogEntry) => React.ReactNode;
  readonly entries: readonly CatalogEntry[];
  readonly onOpen?: () => void;
  /**
   * Возврат из урока ищет карточку по `data-route-material`. Свежий материал стоит и в «Новом», и на
   * полке своей темы; целью возврата служит только полка темы.
   */
  readonly returnTarget?: boolean;
  readonly title: string;
}) {
  return (
    <section className="min-w-0" data-catalog-shelf={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
          {title}
        </h3>
        {onOpen === undefined ? null : (
          <button
            aria-label={`Все ${String(entries.length)}: ${title}`}
            className="inline-flex min-h-8 shrink-0 items-center gap-0.5 text-sm font-semibold text-action hover:text-action-hover focus-visible:outline-2 focus-visible:outline-ring"
            onClick={onOpen}
            type="button"
          >
            Все {entries.length}
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      <ul className="public-horizontal-rail -mx-4 grid snap-x scroll-px-4 auto-cols-[62%] grid-flow-col gap-3 overflow-x-auto px-4 sm:mx-0 sm:scroll-px-0 sm:px-0 @min-[34rem]/catalog:auto-cols-[calc((100%-2rem)/3)] @min-[34rem]/catalog:gap-4">
        {entries.map((entry) => (
          <li
            className="min-w-0 snap-start"
            data-route-material={returnTarget ? entry.material.slug : undefined}
            key={entry.material.slug}
          >
            {card(entry)}
          </li>
        ))}
      </ul>
    </section>
  );
}
