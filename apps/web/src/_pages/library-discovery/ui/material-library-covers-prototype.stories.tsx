import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Bot,
  Check,
  Cpu,
  DraftingCompass,
  type LucideIcon,
  Palette,
  Play,
  Rocket,
  ScanSearch,
} from "lucide-react";
import type { ReactNode } from "react";
import { ContentCoverImage } from "@/entities/material";
import { socialCardTitle } from "@/shared/link-preview";
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
  linkClass,
  type Look,
  noteOf,
  railClass,
  ShelvesPage,
  stay,
  titleClass,
  type TopicId,
  VariantComparison,
} from "./material-library-prototype-kit";

// Throwaway, round 3: the owner wants every Material shown the same way, a picture above a title
// (round 2, variant A4). A Material with its own cover shows it. These variants disagree only on
// what stands in the picture's place when a Material has no cover.
// Switchable via `?variant=` and the bottom bar. Fixture data only.
//
// Owner's decisions 2026-11-12: P5, the link card, without the logo and the site name; the title
// in the vertical middle; the caption names the format; a card whose picture already carries the
// title shows no title under it. «Новое» keeps repeating a fresh Material on its topic shelf, and
// the author orders the topics by hand.

/** What fills the 16:9 picture box of a Material without a cover. */
type Stand = (item: Item) => ReactNode;

const topicLook: Readonly<
  Record<
    TopicId,
    {
      readonly tone: string;
      readonly glyph: LucideIcon;
      /** Fixture picture standing in for the topic's own illustration. */
      readonly picture: number;
    }
  >
> = {
  base: {
    tone: "bg-cover-sand text-cover-sand-foreground",
    glyph: Bot,
    picture: 1,
  },
  spec: {
    tone: "bg-cover-blue text-cover-blue-foreground",
    glyph: DraftingCompass,
    picture: 2,
  },
  design: {
    tone: "bg-cover-lavender text-cover-lavender-foreground",
    glyph: Palette,
    picture: 3,
  },
  review: {
    tone: "bg-cover-coral text-cover-coral-foreground",
    glyph: ScanSearch,
    picture: 4,
  },
  delivery: {
    tone: "bg-cover-mint text-cover-mint-foreground",
    glyph: Rocket,
    picture: 9,
  },
  setup: { tone: "bg-cover-ink text-white", glyph: Cpu, picture: 8 },
};

// ───────────────────────── the one card ─────────────────────────

function PictureCard({
  item,
  note,
  stand,
  titled,
}: {
  readonly item: Item;
  readonly note?: string;
  readonly stand: Stand;
  /** The stand-in picture already carries the title, so none is repeated under it. */
  readonly titled: boolean;
}) {
  const Icon = formatIcons[item.format];
  return (
    <a
      className={cn(linkClass, "flex h-full min-w-0 snap-start flex-col gap-2")}
      href={`#${item.slug}`}
      onClick={stay}
    >
      <span className="relative block aspect-video overflow-hidden rounded-2xl [container-type:inline-size]">
        {item.cover === null ? (
          stand(item)
        ) : (
          <ContentCoverImage
            alt=""
            className="size-full"
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
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium text-white tabular-nums">
          <Icon
            aria-label={formatLabels[item.format]}
            className="size-3"
            {...(isVideo(item) ? { fill: "currentColor" } : {})}
          />
          {item.seconds === undefined ? null : clock(item.seconds)}
        </span>
      </span>
      {titled && item.cover === null ? null : (
        <span className={titleClass}>{item.title}</span>
      )}
      {note === undefined ? null : (
        <span className="mt-auto text-xs text-muted-foreground">{note}</span>
      )}
    </a>
  );
}

function coversLook(stand: Stand, titled = false): Look {
  return {
    preview: (list) => (
      <ul className={railClass}>
        {list.map((item) => (
          <li className="min-w-0 snap-start" key={item.slug}>
            <PictureCard item={item} stand={stand} titled={titled} />
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
                stand={stand}
                titled={titled}
                {...(note === undefined ? {} : { note })}
              />
            </li>
          );
        })}
      </ul>
    ),
  };
}

// ───────────────────────── P1: the topic's colour and sign ─────────────────────────

/** P1: six ready templates, one per topic; a Material adds nothing of its own. */
const topicSign: Stand = (item) => {
  const { glyph: Glyph, tone } = topicLook[item.topic];
  return (
    <span className={cn("absolute inset-0", tone)}>
      <Glyph
        aria-hidden="true"
        className="absolute -top-[5cqw] -right-[7cqw] size-[60cqw] -rotate-12 opacity-55"
        strokeWidth={0.9}
      />
    </span>
  );
};

// ───────────────────────── P2: a pattern built from the Material ─────────────────────────

function seededRandom(seed: string): () => number {
  let state = Array.from(seed).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    7,
  );
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const CELL = 18;
const COLUMNS = 9;
const ROWS = 5;

function quarter(x: number, y: number, corner: number): string {
  const right = x + CELL;
  const bottom = y + CELL;
  const arc = `A ${String(CELL)} ${String(CELL)} 0 0 1`;
  return corner === 0
    ? `M ${String(x)} ${String(y)} L ${String(right)} ${String(y)} ${arc} ${String(x)} ${String(bottom)} Z`
    : corner === 1
      ? `M ${String(right)} ${String(y)} L ${String(right)} ${String(bottom)} ${arc} ${String(x)} ${String(y)} Z`
      : corner === 2
        ? `M ${String(right)} ${String(bottom)} L ${String(x)} ${String(bottom)} ${arc} ${String(right)} ${String(y)} Z`
        : `M ${String(x)} ${String(bottom)} L ${String(x)} ${String(y)} ${arc} ${String(right)} ${String(bottom)} Z`;
}

/** P2: the same seed always draws the same tiles, so a Material keeps its picture. */
const pattern: Stand = (item) => {
  const random = seededRandom(item.slug);
  const accent = Math.floor(random() * COLUMNS * ROWS);
  const cells = Array.from({ length: COLUMNS * ROWS }, (_, index) => {
    const x = (index % COLUMNS) * CELL;
    const y = Math.floor(index / COLUMNS) * CELL;
    const shape = random();
    const corner = Math.floor(random() * 4);
    const opacity = [0.16, 0.3, 0.52][Math.floor(random() * 3)] ?? 0.3;
    const fill =
      index === accent
        ? { fill: "var(--accent-bright)" }
        : { fill: "currentColor", fillOpacity: opacity };
    const key = `${String(x)}-${String(y)}`;
    if (index !== accent && shape < 0.3) return null;
    if (shape < 0.72)
      return <path d={quarter(x, y, corner)} key={key} {...fill} />;
    if (shape < 0.86)
      return (
        <circle
          cx={x + CELL / 2}
          cy={y + CELL / 2}
          key={key}
          r={CELL / 2}
          {...fill}
        />
      );
    return <rect height={CELL} key={key} width={CELL} x={x} y={y} {...fill} />;
  });
  return (
    <svg
      aria-hidden="true"
      className={cn("absolute inset-0 size-full", topicLook[item.topic].tone)}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 160 90"
    >
      {cells}
    </svg>
  );
};

// ───────────────────────── P3: a page of the text ─────────────────────────

/** P3: a text shows a sheet with the start of its summary; a video keeps a dark frame. */
const page: Stand = (item) =>
  isVideo(item) ? (
    <span className="absolute inset-0 grid place-items-center bg-foreground">
      <span className="grid size-[18cqw] place-items-center rounded-full bg-background/15 text-background">
        <Play
          aria-hidden="true"
          className="size-[7cqw] translate-x-px"
          fill="currentColor"
        />
      </span>
    </span>
  ) : (
    <span className="absolute inset-0 bg-cover-sand">
      <span className="absolute inset-x-[9%] top-[13%] bottom-0 rounded-t-[4cqw] bg-card px-[6.5cqw] pt-[6cqw] shadow-card">
        <span
          aria-hidden="true"
          className="block text-[5cqw] leading-[1.45] text-body-muted [mask-image:linear-gradient(to_bottom,black_45%,transparent_92%)]"
        >
          {item.summary} {item.summary}
        </span>
      </span>
    </span>
  );

// ───────────────────────── P4: the topic's picture ─────────────────────────

/** P4: one illustration per topic, reused by every Material of the topic without a cover. */
const topicPicture: Stand = (item) => (
  <ContentCoverImage
    alt=""
    className="size-full"
    cover={cover(topicLook[item.topic].picture, false)}
    fallbackSeed={item.slug}
  />
);

// ───────────────────────── P5: the link card ─────────────────────────

/**
 * P5: the picture the platform generates for a link preview of a coverless Material, without its
 * logo and site name (owner's request 2026-11-12). A local copy of `SocialCardArtwork` with the
 * same colours and sizes, in units of the card width: the production artwork stays unchanged.
 */
const linkCard: Stand = (item) => {
  const title = socialCardTitle(item.title);
  const size = title.length <= 40 ? 76 : title.length <= 70 ? 62 : 52;
  const length = (pixels: number) => `${String(pixels / 12)}cqw`;
  return (
    <span
      // The caption and the title sit in the vertical middle (owner's request 2026-11-12).
      className="absolute inset-0 flex flex-col justify-center"
      style={{
        backgroundColor: "#202124",
        color: "#ffffff",
        padding: length(72),
      }}
    >
      <span className="flex flex-col" style={{ gap: length(24) }}>
        <span
          className="uppercase"
          style={{ fontSize: length(28), letterSpacing: length(4) }}
        >
          {formatLabels[item.format]}
        </span>
        <span
          style={{
            fontSize: length(size),
            letterSpacing: length(-1),
            lineHeight: 1.16,
          }}
        >
          {title}
        </span>
      </span>
      <span
        className="absolute"
        style={{
          backgroundColor: "#c7461e",
          bottom: length(72),
          height: length(6),
          left: length(72),
          width: length(120),
        }}
      />
    </span>
  );
};

// ───────────────────────── switcher ─────────────────────────

const variants = [
  {
    id: "P1",
    name: "Цвет и знак темы",
    note: "Без картинки стоит цвет и знак темы. Шесть шаблонов на шесть тем, рисовать ничего не нужно.",
    render: () => <ShelvesPage look={coversLook(topicSign)} variant="P1" />,
  },
  {
    id: "P2",
    name: "Узор материала",
    note: "Узор строится из адреса материала: у каждого свой и всегда один и тот же. Цвет берётся от темы.",
    render: () => <ShelvesPage look={coversLook(pattern)} variant="P2" />,
  },
  {
    id: "P3",
    name: "Лист с текстом",
    note: "У текста на месте картинки лист с началом описания. У видео без обложки тёмный кадр.",
    render: () => <ShelvesPage look={coversLook(page)} variant="P3" />,
  },
  {
    id: "P4",
    name: "Картинка темы",
    note: "У темы одна картинка. Её получают все материалы темы, у которых нет своей.",
    render: () => <ShelvesPage look={coversLook(topicPicture)} variant="P4" />,
  },
  {
    id: "P5",
    name: "Карточка ссылки",
    note: "Тёмная карточка с форматом и названием, как в превью ссылки, но без логотипа. Под ней название не повторяется.",
    render: () => (
      <ShelvesPage look={coversLook(linkCard, true)} variant="P5" />
    ),
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
      label="Варианты картинки"
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
  title: "Prototypes/Material Library Covers",
  component: Comparison,
} satisfies Meta<typeof Comparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {};
export const CompareMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const TopicSignP1: Story = { args: { initialVariant: "P1" } };
export const PatternP2: Story = { args: { initialVariant: "P2" } };
export const TextPageP3: Story = { args: { initialVariant: "P3" } };
export const TopicPictureP4: Story = { args: { initialVariant: "P4" } };
export const LinkCardP5: Story = { args: { initialVariant: "P5" } };
