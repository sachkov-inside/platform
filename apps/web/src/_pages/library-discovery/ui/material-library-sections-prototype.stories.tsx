import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Play,
  Rows3,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { ContentCoverImage } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  type Collection,
  Empty,
  type Format,
  Frame,
  type Item,
  PartHeading,
  SearchField,
  type TopicId,
  VariantComparison,
  chapterNames,
  chipClass,
  clock,
  collectionItems,
  collections,
  fallbackKind,
  firstDifference,
  formatChips,
  formatIcons,
  formatLabels,
  isNew,
  items,
  matches,
  materialForms,
  monthGroups,
  newestFirst,
  placeLabel,
  plural,
  programmeFirst,
  stay,
  topicName,
  topics,
  videoTotal,
} from "./material-library-prototype-kit";
import styles from "./material-library-sections.prototype.module.css";

// Throwaway, round 1: four ways to organise the Product «Материалы» library beyond programme
// chapters, on the real public shell and programme frame, switchable via `?variant=` and the
// bottom bar. Question: where does a Material that fits no chapter live so that a reader finds it
// later? Owner's pick 2026-11-11: A, shelves by topic; round 2 lives in
// `material-library-shelves-prototype.stories.tsx`.

const gridClass =
  "grid grid-cols-1 gap-x-5 gap-y-7 @min-[34rem]/library:grid-cols-2";
const railClass =
  "public-horizontal-rail -mx-4 grid snap-x scroll-px-4 grid-flow-col auto-cols-[78%] gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0 @min-[34rem]/library:auto-cols-[calc(50%-0.625rem)] @min-[34rem]/library:gap-5";

function FormatChips({
  value,
  onChange,
}: {
  readonly value: Format | "";
  readonly onChange: (value: Format | "") => void;
}) {
  return (
    <div
      aria-label="Формат материала"
      className="public-horizontal-rail -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      role="group"
    >
      {formatChips.map(([slug, label]) => (
        <button
          aria-pressed={value === slug}
          className={chipClass(value === slug)}
          key={slug}
          onClick={() => {
            onChange(slug);
          }}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The accepted A2 cover: format and video length in a badge, «изучено» as a check. */
function CoverFigure({ item }: { readonly item: Item }) {
  const Icon = formatIcons[item.format];
  return (
    <span className="relative block">
      <ContentCoverImage
        alt=""
        className="aspect-video w-full rounded-2xl"
        cover={item.cover}
        fallbackKind={fallbackKind(item)}
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
        <span className="sr-only">{formatLabels[item.format]}</span>
        {item.seconds === undefined ? null : clock(item.seconds)}
      </span>
    </span>
  );
}

function Card({ item, note }: { readonly item: Item; readonly note?: string }) {
  return (
    <a
      className="group/card flex h-full min-w-0 snap-start flex-col gap-2.5 text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      href={`#${item.slug}`}
      onClick={stay}
    >
      <CoverFigure item={item} />
      <span className="mt-0.5 line-clamp-2 text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
        {item.title}
      </span>
      <span className="line-clamp-2 text-sm leading-5 text-body-muted">
        {item.summary}
      </span>
      {note === undefined ? null : (
        <span className="mt-auto text-xs text-muted-foreground">{note}</span>
      )}
    </a>
  );
}

function CardGrid({
  list,
  note,
}: {
  readonly list: readonly Item[];
  readonly note: (item: Item) => string | undefined;
}) {
  return (
    <ul className={gridClass}>
      {list.map((item) => {
        const text = note(item);
        return (
          <li className="min-w-0" key={item.slug}>
            <Card item={item} {...(text === undefined ? {} : { note: text })} />
          </li>
        );
      })}
    </ul>
  );
}

/** A dense row: small picture, title and one line of facts. */
function Row({
  item,
  meta,
  ordinal,
}: {
  readonly item: Item;
  readonly meta: string;
  readonly ordinal?: number;
}) {
  return (
    <a
      className="group/card -mx-2 flex min-w-0 items-center gap-3 rounded-xl p-2 text-foreground no-underline hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      href={`#${item.slug}`}
      onClick={stay}
    >
      {ordinal === undefined ? null : (
        <span className="w-5 shrink-0 text-center text-sm font-semibold text-muted-foreground tabular-nums">
          {ordinal}
        </span>
      )}
      <ContentCoverImage
        alt=""
        className="aspect-video w-20 shrink-0 rounded-lg sm:w-24"
        cover={item.cover}
        fallbackKind={fallbackKind(item)}
        fallbackSeed={item.slug}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm leading-5 font-semibold tracking-[-0.01em] group-hover/card:text-action sm:line-clamp-1 sm:text-[0.9375rem]">
          {item.title}
        </span>
        <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
      {item.read === true ? (
        <Check
          aria-label="Изучено"
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : null}
    </a>
  );
}

function formatFact(item: Item): string {
  return item.seconds === undefined
    ? formatLabels[item.format]
    : `${formatLabels[item.format]} · ${clock(item.seconds)}`;
}

function BackButton({
  children,
  onClick,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onClick}
      type="button"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {children}
    </button>
  );
}

/** A collection opened as a playlist: order, progress and the next unread step. */
function Playlist({ collection }: { readonly collection: Collection }) {
  const list = collectionItems(collection);
  const read = list.filter((item) => item.read === true).length;
  const next = list.find((item) => item.read !== true);
  const total = videoTotal(list);
  return (
    <>
      <header className="rounded-3xl bg-muted p-4 sm:p-5">
        <p className="text-xs font-semibold text-muted-foreground">
          Подборка · {plural(list.length, materialForms)}
          {total === null ? "" : ` · ${total}`}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
          {collection.title}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-body-muted">
          {collection.summary}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {next === undefined ? null : (
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
              type="button"
            >
              <Play
                aria-hidden="true"
                className="size-3.5"
                fill="currentColor"
              />
              {read === 0 ? "Начать" : "Продолжить"}
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            Изучено {read} из {list.length}
          </span>
          <span className="h-1.5 min-w-24 flex-1 rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-action"
              style={{ width: `${String((read / list.length) * 100)}%` }}
            />
          </span>
        </div>
      </header>
      <ol className="mt-4 grid gap-1">
        {list.map((item, index) => (
          <li key={item.slug}>
            <Row
              item={item}
              meta={[formatFact(item), placeLabel(item)]
                .filter((part) => part !== undefined)
                .join(" · ")}
              ordinal={index + 1}
            />
          </li>
        ))}
      </ol>
    </>
  );
}

// ───────────────────────── A: shelves by topic ─────────────────────────

/** A: the page is a row of shelves, one per topic; a topic opens as its own list. */
function TopicShelves() {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<TopicId | null>(null);
  const needle = query.trim().toLocaleLowerCase("ru");
  const found = items.filter((item) => matches(item, needle));
  const opened = topics.find((entry) => entry.id === topic);
  return (
    <Frame variant="A">
      <PartHeading>Материалы</PartHeading>
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
            <span className="font-medium tabular-nums opacity-60">
              {items.filter((item) => item.topic === entry.id).length}
            </span>
          </button>
        ))}
      </div>
      {needle !== "" ? (
        <section className="mt-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Найдено: {plural(found.length, materialForms)}
          </p>
          {found.length === 0 ? (
            <Empty />
          ) : (
            <CardGrid
              list={newestFirst(found)}
              note={(item) => topicName(item.topic)}
            />
          )}
        </section>
      ) : opened === undefined ? (
        <>
          <Shelf
            list={newestFirst(items.filter(isNew))}
            note={(item) => topicName(item.topic)}
            title="Новое"
          />
          {topics.map((entry) => {
            const list = programmeFirst(
              items.filter((item) => item.topic === entry.id),
            );
            return (
              <Shelf
                key={entry.id}
                list={list}
                note={placeLabel}
                onOpen={() => {
                  setTopic(entry.id);
                }}
                summary={entry.summary}
                title={entry.name}
              />
            );
          })}
        </>
      ) : (
        <section className="mt-6">
          <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
            {opened.name}
          </h3>
          <p className="mt-1 mb-4 text-sm leading-6 text-body-muted">
            {opened.summary}
          </p>
          <CardGrid
            list={programmeFirst(
              items.filter((item) => item.topic === opened.id),
            )}
            note={placeLabel}
          />
        </section>
      )}
    </Frame>
  );
}

function Shelf({
  list,
  note,
  onOpen,
  summary,
  title,
}: {
  readonly list: readonly Item[];
  readonly note: (item: Item) => string | undefined;
  readonly onOpen?: () => void;
  readonly summary?: string;
  readonly title: string;
}) {
  if (list.length === 0) return null;
  return (
    <section className="mt-8 first:mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
          {title}
        </h3>
        {onOpen === undefined ? null : (
          <button
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-action hover:text-action-hover focus-visible:outline-2 focus-visible:outline-ring"
            onClick={onOpen}
            type="button"
          >
            Все {list.length}
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {summary === undefined ? null : (
        <p className="mt-0.5 text-sm leading-6 text-body-muted">{summary}</p>
      )}
      <ul className={cn(railClass, "mt-3")}>
        {list.map((item) => {
          const text = note(item);
          return (
            <li className="min-w-0 snap-start" key={item.slug}>
              <Card
                item={item}
                {...(text === undefined ? {} : { note: text })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ───────────────────────── B: curated collections ─────────────────────────

/** B: author-made collections lead the page; the full catalogue follows as it is today. */
function Collections() {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<Format | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const needle = query.trim().toLocaleLowerCase("ru");
  const opened = collections.find((entry) => entry.id === open);
  if (opened !== undefined)
    return (
      <Frame variant="B">
        <BackButton
          onClick={() => {
            setOpen(null);
          }}
        >
          Все материалы
        </BackButton>
        <div className="mt-2">
          <Playlist collection={opened} />
        </div>
      </Frame>
    );
  const shown = items.filter(
    (item) =>
      matches(item, needle) && (format === "" || item.format === format),
  );
  return (
    <Frame variant="B">
      <PartHeading>Материалы</PartHeading>
      <SearchField onChange={setQuery} value={query} />
      {needle !== "" ? null : (
        <section className="mt-6">
          <h3 className="text-base font-semibold tracking-[-0.02em] sm:text-lg">
            Подборки
          </h3>
          <p className="mt-0.5 mb-3 text-sm leading-6 text-body-muted">
            Материалы на одну тему, собранные по порядку.
          </p>
          <ul className="grid grid-cols-1 gap-3 @min-[34rem]/library:grid-cols-2">
            {collections.map((entry) => (
              <li className="min-w-0" key={entry.id}>
                <CollectionCard
                  collection={entry}
                  onOpen={() => {
                    setOpen(entry.id);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-9">
        <h3 className="mb-3 text-base font-semibold tracking-[-0.02em] sm:text-lg">
          Все материалы
        </h3>
        <FormatChips onChange={setFormat} value={format} />
        <p className="mt-3 text-xs text-muted-foreground sm:text-sm">
          {shown.length === items.length
            ? plural(items.length, materialForms)
            : `Найдено: ${plural(shown.length, materialForms)}`}
        </p>
        {shown.length === 0 ? (
          <Empty />
        ) : (
          monthGroups(shown).map((group) => (
            <section className="mt-7 first:mt-4" key={group.id}>
              <h4 className="mb-3 text-sm font-semibold">{group.title}</h4>
              <CardGrid
                list={group.items}
                note={(item) =>
                  placeLabel(item) ??
                  collections.find((entry) => entry.slugs.includes(item.slug))
                    ?.title
                }
              />
            </section>
          ))
        )}
      </section>
    </Frame>
  );
}

function CollectionCard({
  collection,
  onOpen,
}: {
  readonly collection: Collection;
  readonly onOpen: () => void;
}) {
  const list = collectionItems(collection);
  const read = list.filter((item) => item.read === true).length;
  const total = videoTotal(list);
  return (
    <button
      className="group/card flex h-full w-full flex-col rounded-3xl bg-muted p-4 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={onOpen}
      type="button"
    >
      <span aria-hidden="true" className="flex pr-[14%]">
        {list.slice(0, 3).map((item, index) => (
          <span
            className={cn(
              "relative block w-[46%] shrink-0 rounded-xl shadow-md ring-2 ring-muted",
              index === 0 ? "" : "-ml-[14%]",
            )}
            key={item.slug}
            style={{ zIndex: 3 - index, top: `${String(index * 6)}px` }}
          >
            <ContentCoverImage
              alt=""
              className="aspect-video w-full rounded-xl"
              cover={item.cover}
              fallbackKind={fallbackKind(item)}
              fallbackSeed={item.slug}
            />
          </span>
        ))}
      </span>
      <span className="mt-6 text-base leading-6 font-semibold tracking-[-0.02em] group-hover/card:text-action">
        {collection.title}
      </span>
      <span className="mt-1 line-clamp-2 text-sm leading-5 text-body-muted">
        {collection.summary}
      </span>
      <span className="mt-auto flex items-center gap-3 pt-3 text-xs text-muted-foreground">
        <span>
          {plural(list.length, materialForms)}
          {total === null ? "" : ` · ${total}`}
        </span>
        {read === 0 ? null : (
          <span className="ml-auto inline-flex items-center gap-1 font-semibold text-foreground">
            <Check aria-hidden="true" className="size-3.5" />
            {read} из {list.length}
          </span>
        )}
      </span>
    </button>
  );
}

// ───────────────────────── C: filters over a dense list ─────────────────────────

type FacetId = "topic" | "format" | "place" | "status" | "tag";
type Picks = Readonly<Record<FacetId, readonly string[]>>;
const noPicks: Picks = {
  topic: [],
  format: [],
  place: [],
  status: [],
  tag: [],
};

const facets: readonly {
  readonly id: FacetId;
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}[] = [
  {
    id: "topic",
    label: "Тема",
    options: topics.map((topic) => ({ value: topic.id, label: topic.name })),
  },
  {
    id: "format",
    label: "Формат",
    options: [
      { value: "video", label: "Видео" },
      { value: "guide", label: "Гайды" },
      { value: "note", label: "Заметки" },
    ],
  },
  {
    id: "place",
    label: "Программа",
    options: [
      ...chapterNames.map((name, index) => ({
        value: `chapter-${String(index + 1)}`,
        label: `Глава ${String(index + 1)}. ${name}`,
      })),
      { value: "extra", label: "Вне программы" },
    ],
  },
  {
    id: "status",
    label: "Статус",
    options: [
      { value: "unread", label: "Не изучено" },
      { value: "read", label: "Изучено" },
    ],
  },
  {
    id: "tag",
    label: "Метки",
    options: [...new Set(items.flatMap((item) => item.tags))]
      .sort((left, right) => left.localeCompare(right, "ru"))
      .map((tag) => ({ value: tag, label: tag })),
  },
];

function facetValues(item: Item): Readonly<Record<FacetId, readonly string[]>> {
  return {
    topic: [item.topic],
    format: [item.format],
    place: [
      item.place === null ? "extra" : `chapter-${String(item.place.chapter)}`,
    ],
    status: [item.read === true ? "read" : "unread"],
    tag: item.tags,
  };
}

/** Values inside one filter are alternatives; different filters narrow each other. */
function passes(item: Item, picks: Picks, except?: FacetId): boolean {
  const values = facetValues(item);
  return facets.every(
    ({ id }) =>
      id === except ||
      picks[id].length === 0 ||
      picks[id].some((value) => values[id].includes(value)),
  );
}

type FilterOrder = "new" | "programme" | "topic";

/** C: one list narrowed by filters with live counts; no curated structure at all. */
function Filters() {
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Picks>(noPicks);
  const [openFacet, setOpenFacet] = useState<FacetId | null>(null);
  const [order, setOrder] = useState<FilterOrder>("new");
  const [view, setView] = useState<"list" | "grid">("list");
  const needle = query.trim().toLocaleLowerCase("ru");
  const searched = items.filter((item) => matches(item, needle));
  const filtered = searched.filter((item) => passes(item, picks));
  const shown =
    order === "new"
      ? newestFirst(filtered)
      : order === "programme"
        ? programmeFirst(filtered)
        : [...filtered].sort((left, right) =>
            firstDifference(
              topics.findIndex((topic) => topic.id === left.topic) -
                topics.findIndex((topic) => topic.id === right.topic),
              right.publishedAt.localeCompare(left.publishedAt),
            ),
          );
  const toggle = (id: FacetId, value: string) => {
    setPicks({
      ...picks,
      [id]: picks[id].includes(value)
        ? picks[id].filter((entry) => entry !== value)
        : [...picks[id], value],
    });
  };
  const active = facets.flatMap((facet) =>
    picks[facet.id].map((value) => ({
      id: facet.id,
      value,
      label:
        facet.options.find((option) => option.value === value)?.label ?? value,
    })),
  );
  const facet = facets.find((entry) => entry.id === openFacet);
  return (
    <Frame variant="C">
      <PartHeading>Материалы</PartHeading>
      <SearchField
        onChange={setQuery}
        placeholder="Найти по названию, теме или метке"
        value={query}
      />
      <div className="relative z-20 mt-2.5 sm:mt-3">
        <div
          aria-label="Фильтры"
          className="public-horizontal-rail -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
          role="group"
        >
          {facets.map((entry) => (
            <button
              aria-expanded={openFacet === entry.id}
              className={cn(
                chipClass(false),
                picks[entry.id].length > 0 || openFacet === entry.id
                  ? "text-foreground ring-1 ring-foreground/25"
                  : "",
              )}
              key={entry.id}
              onClick={() => {
                setOpenFacet(openFacet === entry.id ? null : entry.id);
              }}
              type="button"
            >
              {entry.label}
              {picks[entry.id].length === 0 ? null : (
                <span className="grid size-4.5 place-items-center rounded-full bg-primary text-[0.65rem] text-primary-foreground tabular-nums">
                  {picks[entry.id].length}
                </span>
              )}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          ))}
        </div>
        {facet === undefined ? null : (
          <div
            className={cn(
              "absolute top-full left-0 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-xl sm:w-88",
              facet.id === "tag" ? "grid grid-cols-2 gap-x-1" : "",
            )}
          >
            {facet.options.map((option) => {
              const count = searched.filter(
                (item) =>
                  passes(item, picks, facet.id) &&
                  facetValues(item)[facet.id].includes(option.value),
              ).length;
              return (
                <label
                  className={cn(
                    "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-muted",
                    count === 0 ? "text-muted-foreground" : "",
                  )}
                  key={option.value}
                >
                  <input
                    checked={picks[facet.id].includes(option.value)}
                    className="size-4 shrink-0 accent-(--primary)"
                    onChange={() => {
                      toggle(facet.id, option.value);
                    }}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      {openFacet === null ? null : (
        <button
          aria-label="Закрыть фильтр"
          className="fixed inset-0 z-10 cursor-default"
          onClick={() => {
            setOpenFacet(null);
          }}
          type="button"
        />
      )}
      {active.length === 0 ? null : (
        <ul className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {active.map((entry) => (
            <li key={`${entry.id}:${entry.value}`}>
              <button
                className="inline-flex min-h-7 items-center gap-1 rounded-full bg-primary py-0.5 pr-1.5 pl-2.5 text-xs font-semibold text-primary-foreground"
                onClick={() => {
                  toggle(entry.id, entry.value);
                }}
                type="button"
              >
                {entry.label}
                <X aria-label="Убрать" className="size-3.5 opacity-70" />
              </button>
            </li>
          ))}
          <li>
            <button
              className="min-h-7 px-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => {
                setPicks(noPicks);
              }}
              type="button"
            >
              Сбросить
            </button>
          </li>
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 sm:mt-4">
        <p
          aria-live="polite"
          className="text-xs text-muted-foreground sm:text-sm"
        >
          {shown.length === items.length
            ? plural(items.length, materialForms)
            : `Найдено: ${String(shown.length)} из ${String(items.length)}`}
        </p>
        <div className="flex items-center gap-2">
          <select
            aria-label="Порядок"
            className="h-9 rounded-lg bg-muted px-2 text-sm font-semibold text-foreground"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setOrder(
                value === "programme" || value === "topic" ? value : "new",
              );
            }}
            value={order}
          >
            <option value="new">Сначала новые</option>
            <option value="programme">По программе</option>
            <option value="topic">По теме</option>
          </select>
          <div className="flex rounded-lg bg-muted p-0.5" role="group">
            {(
              [
                ["list", "Список", Rows3],
                ["grid", "Карточки", LayoutGrid],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                aria-label={label}
                aria-pressed={view === value}
                className={cn(
                  "grid size-8 place-items-center rounded-md",
                  view === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                key={value}
                onClick={() => {
                  setView(value);
                }}
                type="button"
              >
                <Icon aria-hidden="true" className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty />
      ) : view === "list" ? (
        <ul className="mt-3 grid gap-1">
          {shown.map((item) => (
            <li key={item.slug}>
              <Row
                item={item}
                meta={[
                  formatFact(item),
                  topicName(item.topic),
                  placeLabel(item),
                  ...item.tags.map((tag) => `#${tag}`),
                ]
                  .filter((part) => part !== undefined)
                  .join(" · ")}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          <CardGrid
            list={shown}
            note={(item) =>
              [topicName(item.topic), placeLabel(item)]
                .filter((part) => part !== undefined)
                .join(" · ")
            }
          />
        </div>
      )}
    </Frame>
  );
}

// ───────────────────────── D: sections in the sidebar ─────────────────────────

/** D: topics and collections become sections under «Материалы» in the product sidebar. */
function SidebarSections() {
  const [section, setSection] = useState("all");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<Format | "">("");
  const needle = query.trim().toLocaleLowerCase("ru");
  const topic = topics.find((entry) => `topic:${entry.id}` === section);
  const collection = collections.find(
    (entry) => `collection:${entry.id}` === section,
  );
  const scope =
    topic !== undefined
      ? items.filter((item) => item.topic === topic.id)
      : collection !== undefined
        ? collectionItems(collection)
        : section === "new"
          ? items.filter(isNew)
          : items;
  const shown = scope.filter(
    (item) =>
      matches(item, needle) && (format === "" || item.format === format),
  );
  const top = [
    { key: "all", label: "Все материалы", count: items.length },
    { key: "new", label: "Новое", count: items.filter(isNew).length },
  ];
  const topicEntries = topics.map((entry) => ({
    key: `topic:${entry.id}`,
    label: entry.name,
    count: items.filter((item) => item.topic === entry.id).length,
  }));
  const collectionEntries = collections.map((entry) => ({
    key: `collection:${entry.id}`,
    label: entry.title,
    count: entry.slugs.length,
  }));
  const list = (entries: typeof top) => (
    <ul>
      {entries.map((entry) => (
        <li key={entry.key}>
          <button
            aria-current={section === entry.key ? "true" : undefined}
            className={styles["sectionItem"]}
            data-current={section === entry.key}
            onClick={() => {
              setSection(entry.key);
            }}
            type="button"
          >
            <span>{entry.label}</span>
            <small>{entry.count}</small>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <Frame
      sidebar={
        <div className={styles["sections"]}>
          {list(top)}
          <p className={styles["sectionsTitle"]}>Темы</p>
          {list(topicEntries)}
          <p className={styles["sectionsTitle"]}>Подборки</p>
          {list(collectionEntries)}
        </div>
      }
      variant="D"
    >
      {/* Below 64 rem the sidebar has no labels, so the same sections move into one select. */}
      <label className="mb-4 flex min-h-11 items-center gap-2 rounded-xl bg-muted px-3 text-sm lg:hidden">
        <span className="shrink-0 text-muted-foreground">Раздел</span>
        <select
          className="min-w-0 flex-1 bg-transparent text-base font-semibold text-foreground outline-none"
          onChange={(event) => {
            setSection(event.currentTarget.value);
          }}
          value={section}
        >
          {top.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label} ({entry.count})
            </option>
          ))}
          <optgroup label="Темы">
            {topicEntries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.count})
              </option>
            ))}
          </optgroup>
          <optgroup label="Подборки">
            {collectionEntries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.count})
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {collection !== undefined ? (
        <Playlist collection={collection} />
      ) : (
        <>
          <PartHeading>
            {topic?.name ?? (section === "new" ? "Новое" : "Материалы")}
          </PartHeading>
          {topic === undefined ? null : (
            <p className="mt-1 text-sm leading-6 text-body-muted">
              {topic.summary}
            </p>
          )}
          <SearchField
            onChange={setQuery}
            placeholder={
              topic === undefined ? "Найти материал" : "Найти в этой теме"
            }
            value={query}
          />
          <div className="mt-2.5 sm:mt-3">
            <FormatChips onChange={setFormat} value={format} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground sm:text-sm">
            {shown.length === scope.length
              ? plural(scope.length, materialForms)
              : `Найдено: ${plural(shown.length, materialForms)}`}
          </p>
          {shown.length === 0 ? (
            <Empty />
          ) : topic !== undefined ? (
            <div className="mt-4">
              <CardGrid list={programmeFirst(shown)} note={placeLabel} />
            </div>
          ) : (
            monthGroups(shown).map((group) => (
              <section className="mt-7 first:mt-4" key={group.id}>
                <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
                <CardGrid
                  list={group.items}
                  note={(item) =>
                    [topicName(item.topic), placeLabel(item)]
                      .filter((part) => part !== undefined)
                      .join(" · ")
                  }
                />
              </section>
            ))
          )}
        </>
      )}
    </Frame>
  );
}

// ───────────────────────── switcher ─────────────────────────

const variants = [
  {
    id: "A",
    name: "Полки по темам",
    note: "У материала одна тема. Новый материал про дизайн встаёт на полку «Дизайн с агентами».",
    render: () => <TopicShelves />,
  },
  {
    id: "B",
    name: "Подборки",
    note: "Автор собирает материалы в подборки по порядку. Каталог по месяцам остаётся ниже.",
    render: () => <Collections />,
  },
  {
    id: "C",
    name: "Фильтры",
    note: "Один плотный список. Тема, формат, глава, статус и метки сужают его, счётчики живые.",
    render: () => <Filters />,
  },
  {
    id: "D",
    name: "Разделы в боковой колонке",
    note: "Темы и подборки стоят под «Материалами» слева. На телефоне это один выпадающий список.",
    render: () => <SidebarSections />,
  },
] as const;
type VariantId = (typeof variants)[number]["id"];

function Comparison({
  initialVariant,
}: {
  readonly initialVariant?: VariantId;
}) {
  return (
    <VariantComparison
      label="Варианты библиотеки"
      variants={variants}
      {...(initialVariant === undefined ? {} : { initialVariant })}
    />
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
  title: "Prototypes/Material Library Sections",
  component: Comparison,
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;

const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const Compare: Story = {};
export const CompareMobile: Story = { ...mobile };
export const TopicShelvesA: Story = { args: { initialVariant: "A" } };
export const CollectionsB: Story = { args: { initialVariant: "B" } };
export const FiltersC: Story = { args: { initialVariant: "C" } };
export const SidebarSectionsD: Story = { args: { initialVariant: "D" } };
export const SidebarSectionsDMobile: Story = {
  ...mobile,
  args: { initialVariant: "D" },
};
