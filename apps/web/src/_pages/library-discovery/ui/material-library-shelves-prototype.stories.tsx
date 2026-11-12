import type { Meta, StoryObj } from "@storybook/react-vite";
import { Check, Play } from "lucide-react";
import { ContentCoverImage, type ContentCover } from "@/entities/material";
import { cn } from "@/shared/lib/utils";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  clock,
  cover,
  formatIcons,
  formatLabels,
  gridClass,
  isVideo,
  type Item,
  items,
  linkClass,
  type Look,
  noteOf,
  type Place,
  railClass,
  ShelvesPage,
  stay,
  titleClass,
  VariantComparison,
} from "./material-library-prototype-kit";

// Throwaway, round 2: the owner picked «Полки по темам» (round 1, variant A). The shelves stay;
// these variants disagree on how a video differs from a text Material that has no cover, and all
// of them drop card summaries and topic descriptions from the overview to cut the text.
// Switchable via `?variant=` and the bottom bar. Fixture data only.

// ───────────────────────── pieces ─────────────────────────

function ReadMark({ className }: { readonly className?: string }) {
  return (
    <Check
      aria-label="Изучено"
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

/** A video's picture: its cover, or a plain charcoal frame with a play mark when it has none. */
function Poster({ item }: { readonly item: Item }) {
  return (
    <span className="relative block overflow-hidden rounded-2xl">
      {item.cover === null ? (
        <span className="grid aspect-video w-full place-items-center bg-foreground">
          <span className="grid size-10 place-items-center rounded-full bg-background/15 text-background">
            <Play
              aria-hidden="true"
              className="size-4 translate-x-px"
              fill="currentColor"
            />
          </span>
        </span>
      ) : (
        <ContentCoverImage
          alt=""
          className="aspect-video w-full"
          cover={item.cover}
          fallbackSeed={item.slug}
        />
      )}
      {item.read === true ? (
        <span className="absolute top-2 right-2 grid size-5.5 place-items-center rounded-full bg-white/90 text-foreground">
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          <span className="sr-only">Изучено</span>
        </span>
      ) : null}
      {item.seconds === undefined ? null : (
        <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium text-white tabular-nums">
          {clock(item.seconds)}
        </span>
      )}
    </span>
  );
}

function VideoCard({
  item,
  note,
}: {
  readonly item: Item;
  readonly note?: string;
}) {
  return (
    <a
      className={cn(linkClass, "flex h-full min-w-0 snap-start flex-col gap-2")}
      href={`#${item.slug}`}
      onClick={stay}
    >
      <Poster item={item} />
      <span className={titleClass}>{item.title}</span>
      {note === undefined ? null : (
        <span className="mt-auto text-xs text-muted-foreground">{note}</span>
      )}
    </a>
  );
}

// ───────────────────────── A1: video cards, text rows ─────────────────────────

function TextRows({
  list,
  place,
}: {
  readonly list: readonly Item[];
  readonly place: Place;
}) {
  return (
    <ul className="divide-y divide-border">
      {list.map((item) => {
        const Icon = formatIcons[item.format];
        const note = noteOf(item, place);
        return (
          <li key={item.slug}>
            <a
              className={cn(linkClass, "flex min-h-12 items-center gap-3 py-2")}
              href={`#${item.slug}`}
              onClick={stay}
            >
              <Icon
                aria-label={formatLabels[item.format]}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className={cn(titleClass, "min-w-0 flex-1")}>
                {item.title}
              </span>
              {note === undefined ? null : (
                <span className="hidden shrink-0 text-xs text-muted-foreground @min-[34rem]/library:inline">
                  {note}
                </span>
              )}
              {item.read === true ? <ReadMark /> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** A1: only a video has a picture; texts are plain rows under the videos of the same topic. */
const mixedLook: Look = {
  preview: (list, place) => {
    const videos = list.filter(isVideo).slice(0, 3);
    const texts = list.filter((item) => !isVideo(item)).slice(0, 3);
    return (
      <>
        {videos.length === 0 ? null : (
          <ul className={railClass}>
            {videos.map((item) => (
              <li className="min-w-0 snap-start" key={item.slug}>
                <VideoCard item={item} />
              </li>
            ))}
          </ul>
        )}
        {texts.length === 0 ? null : (
          <div className={videos.length === 0 ? "" : "mt-3"}>
            <TextRows list={texts} place={place} />
          </div>
        )}
      </>
    );
  },
  full: (list, place) => {
    const videos = list.filter(isVideo);
    const texts = list.filter((item) => !isVideo(item));
    return (
      <>
        {videos.length === 0 ? null : (
          <ul className={gridClass}>
            {videos.map((item) => {
              const note = noteOf(item, place);
              return (
                <li className="min-w-0" key={item.slug}>
                  <VideoCard
                    item={item}
                    {...(note === undefined ? {} : { note })}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {texts.length === 0 ? null : (
          <div className={videos.length === 0 ? "" : "mt-5"}>
            <TextRows list={texts} place={place} />
          </div>
        )}
      </>
    );
  },
};

// ───────────────────────── A2: rows only ─────────────────────────

function GlyphRows({
  list,
  place,
}: {
  readonly list: readonly Item[];
  /** Without a place the row carries no second fact: the overview stays bare. */
  readonly place?: Place;
}) {
  return (
    <ul className="divide-y divide-border">
      {list.map((item) => {
        const Icon = formatIcons[item.format];
        const note = place === undefined ? undefined : noteOf(item, place);
        return (
          <li key={item.slug}>
            <a
              className={cn(linkClass, "flex min-h-12 items-center gap-3 py-2")}
              href={`#${item.slug}`}
              onClick={stay}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg",
                  isVideo(item)
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon
                  aria-label={formatLabels[item.format]}
                  className="size-3.5"
                  {...(isVideo(item) ? { fill: "currentColor" } : {})}
                />
              </span>
              <span className={cn(titleClass, "min-w-0 flex-1")}>
                {item.title}
              </span>
              {note === undefined ? null : (
                <span className="hidden shrink-0 text-xs text-muted-foreground @min-[34rem]/library:inline">
                  {note}
                </span>
              )}
              {item.seconds === undefined ? null : (
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {clock(item.seconds)}
                </span>
              )}
              {item.read === true ? <ReadMark /> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** A2: no pictures at all; a glyph names the format and topics stand in two columns. */
const rowsLook: Look = {
  columns: true,
  preview: (list) => <GlyphRows list={list.slice(0, 4)} />,
  full: (list, place) => <GlyphRows list={list} place={place} />,
};

// ───────────────────────── A3: text as a title tile ─────────────────────────

function PaperTile({
  item,
  note,
}: {
  readonly item: Item;
  readonly note?: string;
}) {
  const Icon = formatIcons[item.format];
  return (
    <a
      className={cn(
        linkClass,
        "flex h-full min-h-32 min-w-0 snap-start flex-col rounded-2xl bg-muted p-3.5 transition-colors hover:bg-secondary",
      )}
      href={`#${item.slug}`}
      onClick={stay}
    >
      <span
        className={cn(
          titleClass,
          "line-clamp-4 text-base leading-[1.35rem] @min-[34rem]/library:text-[1.0625rem]",
        )}
      >
        {item.title}
      </span>
      <span className="mt-auto flex items-center gap-1.5 pt-3 text-xs font-semibold text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {note ?? formatLabels[item.format]}
        </span>
        {item.read === true ? <ReadMark className="ml-auto" /> : null}
      </span>
    </a>
  );
}

function Tiles({
  className,
  list,
  place,
}: {
  readonly className: string;
  readonly list: readonly Item[];
  /** Without a place the tile carries no second fact. */
  readonly place?: Place;
}) {
  return (
    <ul className={className}>
      {list.map((item) => {
        const note = place === undefined ? undefined : noteOf(item, place);
        const props = { item, ...(note === undefined ? {} : { note }) };
        return (
          <li className="min-w-0 snap-start" key={item.slug}>
            {isVideo(item) ? (
              <VideoCard {...props} />
            ) : (
              <PaperTile {...props} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A3: a video keeps its picture; a text is a tile whose own title is the cover. */
const tilesLook: Look = {
  preview: (list) => <Tiles className={railClass} list={list} />,
  full: (list, place) => (
    <Tiles className={gridClass} list={list} place={place} />
  ),
};

// ───────────────────────── A4: a picture for every Material ─────────────────────────

/** Stand-in for a drawn or generated picture: the fixture has eleven. */
function pictureOf(item: Item): ContentCover {
  return item.cover ?? cover((items.indexOf(item) % 11) + 1, false);
}

function PictureCard({
  item,
  note,
}: {
  readonly item: Item;
  readonly note?: string;
}) {
  const Icon = formatIcons[item.format];
  return (
    <a
      className={cn(linkClass, "flex h-full min-w-0 snap-start flex-col gap-2")}
      href={`#${item.slug}`}
      onClick={stay}
    >
      <span className="relative block overflow-hidden rounded-2xl">
        <ContentCoverImage
          alt=""
          className="aspect-video w-full"
          cover={pictureOf(item)}
          fallbackSeed={item.slug}
        />
        {item.read === true ? (
          <span className="absolute top-2 right-2 grid size-5.5 place-items-center rounded-full bg-white/90 text-foreground">
            <Check aria-hidden="true" className="size-3" strokeWidth={3} />
            <span className="sr-only">Изучено</span>
          </span>
        ) : null}
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium text-white tabular-nums">
          <Icon
            aria-label={formatLabels[item.format]}
            className="size-3"
            {...(isVideo(item) ? { fill: "currentColor" } : {})}
          />
          {item.seconds === undefined ? null : clock(item.seconds)}
        </span>
      </span>
      <span className={titleClass}>{item.title}</span>
      {note === undefined ? null : (
        <span className="mt-auto text-xs text-muted-foreground">{note}</span>
      )}
    </a>
  );
}

/** A4: every Material has a picture, so videos and texts differ only by the badge. */
const picturesLook: Look = {
  preview: (list) => (
    <ul className={railClass}>
      {list.map((item) => (
        <li className="min-w-0 snap-start" key={item.slug}>
          <PictureCard item={item} />
        </li>
      ))}
    </ul>
  ),
  full: (list, place) => (
    <ul className={gridClass}>
      {list.map((item) => {
        const note = noteOf(item, place);
        return (
          <li className="min-w-0" key={item.slug}>
            <PictureCard
              item={item}
              {...(note === undefined ? {} : { note })}
            />
          </li>
        );
      })}
    </ul>
  ),
};

// ───────────────────────── switcher ─────────────────────────

const variants = [
  {
    id: "A1",
    name: "Видео карточками, тексты строками",
    note: "Картинка есть только у видео. Тексты идут под ними строками, без картинок.",
    render: () => <ShelvesPage look={mixedLook} variant="A1" />,
  },
  {
    id: "A2",
    name: "Только строки",
    note: "Картинок нет совсем. Формат виден по значку слева, длина видео справа.",
    render: () => <ShelvesPage look={rowsLook} variant="A2" />,
  },
  {
    id: "A3",
    name: "Тексты плитками",
    note: "У видео кадр, у текста плитка с названием внутри. Картинку для текста готовить не нужно.",
    render: () => <ShelvesPage look={tilesLook} variant="A3" />,
  },
  {
    id: "A4",
    name: "Картинка у каждого",
    note: "Картинка есть у всех материалов. Для каждого текста её придётся рисовать или генерировать.",
    render: () => <ShelvesPage look={picturesLook} variant="A4" />,
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
      label="Варианты полок"
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
  title: "Prototypes/Material Library Shelves",
  component: Comparison,
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {};
export const CompareMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const VideoCardsTextRowsA1: Story = { args: { initialVariant: "A1" } };
export const RowsOnlyA2: Story = { args: { initialVariant: "A2" } };
export const TextTilesA3: Story = { args: { initialVariant: "A3" } };
export const PictureForEveryA4: Story = { args: { initialVariant: "A4" } };
