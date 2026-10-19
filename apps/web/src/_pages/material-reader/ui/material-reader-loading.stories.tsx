import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";
import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { productPurchaseHref } from "@/shared/routing/subscription-route";
import {
  boxOf,
  desktop,
  mobile,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { courseSource } from "@/storybook/course-reading.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import {
  MaterialReaderAccess,
  MaterialReaderLoading,
  MaterialReaderPending,
} from "./material-reader-states";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { SavedReadingAction } from "@/features/reading-progress";
import { MaterialReaderView } from "./material-reader-view";

const material = {
  materialId: "course-intro-id",
  contentVersion: 1,
  access: "closed",
  cover: null,
  format: { name: "Гайд", slug: "guide" },
  difficulty: "basic",
  outcomes: [
    "Понимать, как страница приходит слоями",
    "Проверять, что шапка стоит на месте",
  ],
  publishedAt: "2026-09-17T05:00:00.000Z",
  seriesMemberships: [
    {
      ordinal: 3,
      series: {
        id: "72000000-0000-4000-8000-000000000005",
        name: "Создание Platform Inside",
        slug: "ai-engineering",
      },
    },
  ],
  slug: "course-intro",
  summary:
    "Общая часть урока приходит из кеша сразу, а закрытое тело стримится на своё место.",
  tags: [],
  title: "Как урок открывается без чужого скелета",
  topic: { name: "Platform", slug: "platform" },
} as const satisfies MaterialReaderMetadata;

const body = Array.from({ length: 8 }, (_, index): ReaderBlock => ({
  kind: "paragraph",
  content: [
    {
      kind: "text",
      marks: [],
      text: `Абзац ${String(index + 1)}. Текст урока занимает место, которое до него держали строки скелета, и не двигает шапку.`,
    },
  ],
}));

const returnTarget = parseMaterialReaderReturnTarget(
  "/products/ai-engineering/programme",
);
const seriesContext = resolveSeriesReaderContext({
  currentMaterialSlug: material.slug,
  returnTarget,
  series: {
    ...courseSource,
    chapters: courseSource.chapters.map((chapter) => ({
      ...chapter,
      summary: "",
    })),
  },
});

type Outcome = "opened" | "locked";

function StagedReader({
  outcome,
  sequence,
}: {
  readonly outcome: Outcome;
  readonly sequence: StagedLoading;
}) {
  return (
    <Suspense fallback={<MaterialReaderLoading />}>
      <SharedPart outcome={outcome} sequence={sequence} />
    </Suspense>
  );
}

function SharedPart({
  outcome,
  sequence,
}: {
  readonly outcome: Outcome;
  readonly sequence: StagedLoading;
}) {
  use(sequence.sharedPart);
  return (
    <Suspense
      fallback={
        <MaterialReaderPending
          material={material}
          returnTarget={returnTarget}
          seriesContext={seriesContext}
        />
      }
    >
      <PersonalPart outcome={outcome} sequence={sequence} />
    </Suspense>
  );
}

function PersonalPart({
  outcome,
  sequence,
}: {
  readonly outcome: Outcome;
  readonly sequence: StagedLoading;
}) {
  use(sequence.personalPart);
  return outcome === "opened" ? (
    <MaterialReaderView
      body={body}
      bookmarkAction={
        <SavedBookmarkAction compact materialId={material.materialId} />
      }
      material={material}
      primaryVideo={null}
      readingAction={
        <SavedReadingAction
          compact
          format={material.format.slug}
          materialId={material.materialId}
        />
      }
      topReadingAction={
        <SavedReadingAction
          compact
          format={material.format.slug}
          materialId={material.materialId}
        />
      }
      topBookmarkAction={
        <SavedBookmarkAction compact materialId={material.materialId} />
      }
      returnTarget={returnTarget}
      seriesContext={seriesContext}
    />
  ) : (
    <MaterialReaderAccess
      invitation={{
        href: productPurchaseHref("ai-engineering"),
        kind: "product",
      }}
      material={material}
      returnTarget={returnTarget}
      seriesContext={seriesContext}
    />
  );
}

const measure = (canvasElement: HTMLElement) => ({
  header: boxOf(canvasElement, "[data-reader-header]"),
  actions: boxOf(canvasElement, "[data-reader-top-actions]"),
});

const environment = publicPageEnvironment("/materials/instant-navigation");
const meta = {
  ...environment,
  component: MaterialReaderView,
  title: "Pages/Material Reader/Loading",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Переход в урок: скелет маршрута, общая часть из гостевого кеша и личная часть встают на одно место (#670).",
      },
    },
  },
  args: { body, material, primaryVideo: null },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The unknown route has its own skeleton. Once the checked course is known, the personal body or
 * access result preserves the shared header and action reservation, including enlarged text.
 */
function loadsInPlace(
  { globals, width }: StoryViewport,
  outcome: Outcome,
  fontSize = "100%",
): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <StagedReader outcome={outcome} sequence={stagedLoadingOf(loaded)} />
    ),
    play: async ({ canvasElement, loaded }) => {
      const originalFontSize = document.documentElement.style.fontSize;
      document.documentElement.style.fontSize = fontSize;
      try {
        await settleStoryFrame(width);
        const sequence = stagedLoadingOf(loaded);
        const canvas = within(canvasElement);
        await expect(
          await canvas.findByLabelText("Материал загружается"),
        ).toHaveAttribute("aria-busy", "true");
        const skeleton = boxOf(canvasElement, "[data-reader-header]");
        await expect(skeleton.width).toBeLessThanOrEqual(width);

        sequence.deliverSharedPart();
        await canvas.findByRole("heading", { level: 1, name: material.title });
        await expect(
          canvas.getByLabelText("Текст материала загружается"),
        ).toHaveAttribute("aria-busy", "true");
        const headerActions = canvas.getByRole("navigation", {
          name: "Действия материала",
        });
        await expect(within(headerActions).getAllByRole("button")).toHaveLength(
          2,
        );
        await expect(
          canvas.getByRole("group", { name: "Отметка изучения" }),
        ).toBeVisible();
        const sharedPart = measure(canvasElement);

        sequence.deliverPersonalPart();
        if (outcome === "opened") await canvas.findByText(/^Абзац 1\./u);
        else await canvas.findByRole("link", { name: /Получить доступ/u });
        const ready = measure(canvasElement);

        // The unknown route skeleton cannot know a checked Product. Known course layers reserve the same frame.
        await expect(sharedPart).toEqual(ready);
      } finally {
        document.documentElement.style.fontSize = originalFontSize;
      }
    },
  };
}

export const OpenedLoadsInPlace: Story = { ...loadsInPlace(desktop, "opened") };
export const OpenedLoadsInPlaceMobile: Story = {
  ...loadsInPlace(mobile, "opened"),
};
export const LockedLoadsInPlace: Story = { ...loadsInPlace(desktop, "locked") };
export const LockedLoadsInPlaceMobile: Story = {
  ...loadsInPlace(mobile, "locked"),
};

export const OpenedLoadsInPlaceLargeText: Story = {
  ...loadsInPlace(desktop, "opened", "200%"),
};
export const OpenedLoadsInPlaceLargeTextMobile: Story = {
  ...loadsInPlace(mobile, "opened", "200%"),
};
export const LockedLoadsInPlaceLargeText: Story = {
  ...loadsInPlace(desktop, "locked", "200%"),
};
export const LockedLoadsInPlaceLargeTextMobile: Story = {
  ...loadsInPlace(mobile, "locked", "200%"),
};

const videoMaterial = {
  ...material,
  format: { name: "Видео", slug: "video" },
};
export const PendingVideo: Story = {
  render: () => (
    <MaterialReaderPending
      material={videoMaterial}
      returnTarget={returnTarget}
      seriesContext={seriesContext}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const marks = canvas.getAllByRole("button", { name: "Просмотрено" });
    await expect(marks).toHaveLength(1);
    for (const mark of marks) await expect(mark).toBeDisabled();
    const top = canvas.getByRole("navigation", { name: "Действия материала" });
    await expect(top).toBeVisible();
    await expect(
      canvas.getByRole("navigation", { name: "Шаги курса" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("navigation", { name: "Действия в конце материала" }),
    ).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Изучено" })).toBeNull();
  },
};
export const LockedVideo: Story = {
  ...PendingVideo,
  render: () => (
    <MaterialReaderAccess
      invitation={null}
      material={videoMaterial}
      returnTarget={returnTarget}
      seriesContext={seriesContext}
    />
  ),
};
