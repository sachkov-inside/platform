import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SavedBookmarkAction } from "@/features/bookmarks";
import {
  ReadingProgressProvider,
  SavedReadingAction,
} from "@/features/reading-progress";
import { getQueryClient } from "@/shared/api/query-client";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { MaterialReaderView } from "./material-reader-view";

const materialId = "10000000-0000-4000-8000-000000001336";
const accountId = "20000000-0000-4000-8000-000000001336";
const at = "2026-10-10T08:00:00.000Z";
const programme = "/products/ai-engineering/programme";
const environment = publicPageEnvironment("/materials/course-intro", {
  account: "authenticated",
});
let isRead = false;
let bookmarked = false;
let version = 0;
let release: (() => void) | undefined;
const readingState = () => ({
  materialId,
  isRead,
  version,
  readAt: isRead ? at : null,
  updatedAt: version > 0 ? at : null,
});
const bookmarkState = () => ({
  materialId,
  bookmarked,
  bookmarkedAt: bookmarked ? at : null,
});

const meta = {
  ...environment,
  title: "Pages/Material Reader actions",
  component: MaterialReaderView,
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    isRead = false;
    bookmarked = false;
    version = 0;
    release = undefined;
    return fetchBeforeRender(async (input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      if (path === "/api/reading-progress/states")
        return Response.json({ kind: "ready", states: [readingState()] });
      if (path === "/api/bookmarks/states")
        return Response.json({ kind: "ready", states: [bookmarkState()] });
      const body =
        input instanceof Request ? await input.formData() : init?.body;
      if (!(body instanceof FormData))
        throw new Error(`Unexpected request: ${path}`);
      if (path === "/api/reading-progress/state") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        isRead = body.get("isRead") === "true";
        version += 1;
        return Response.json({
          kind: "saved",
          state: readingState(),
          replayed: false,
        });
      }
      if (path === "/api/bookmarks/state") {
        bookmarked = body.get("bookmarked") === "true";
        return Response.json({ kind: "ready", state: bookmarkState() });
      }
      throw new Error(`Unexpected request: ${path}`);
    })();
  },
  decorators: [
    (Story) => (
      <ReadingProgressProvider accountId={accountId} resolved>
        <Story />
      </ReadingProgressProvider>
    ),
    ...environment.decorators,
  ],
  args: {
    material: {
      materialId,
      contentVersion: 1,
      access: "free",
      cover: null,
      format: { name: "Гайд", slug: "guide" },
      difficulty: "basic",
      outcomes: [],
      publishedAt: at,
      seriesMemberships: [],
      slug: "course-intro",
      title: "Как устроен курс",
      summary: "Путь обучения и задания курса.",
      tags: [],
      topic: { name: "AI-агенты", slug: "ai-agents" },
    },
    body: Array.from({ length: 16 }, () => ({
      kind: "paragraph" as const,
      content: [
        {
          kind: "text" as const,
          text: "Проходи материалы в порядке программы. Верхняя строка помогает перейти к следующему уроку, сохранить закладку или отметить изученное.",
          marks: [],
        },
      ],
    })),
    primaryVideo: null,
    returnTarget: parseMaterialReaderReturnTarget(programme),
    seriesContext: {
      currentPosition: 2,
      totalMaterials: 3,
      series: {
        name: "AI Engineering",
        href: programme,
        hasModeVariants: false,
      },
      previous: {
        title: "Первый урок",
        href: "/materials/first?from=%2Fproducts%2Fai-engineering%2Fprogramme",
      },
      next: {
        title: "Следующий урок",
        href: "/materials/next?from=%2Fproducts%2Fai-engineering%2Fprogramme",
      },
    },
    readingAction: (
      <SavedReadingAction format="guide" materialId={materialId} />
    ),
    bookmarkAction: <SavedBookmarkAction materialId={materialId} />,
    topReadingAction: (
      <SavedReadingAction compact format="guide" materialId={materialId} />
    ),
    topBookmarkAction: <SavedBookmarkAction compact materialId={materialId} />,
  },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SyncedActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByRole("navigation", {
      name: "Действия материала",
    });
    const bottom = canvasElement.querySelector<HTMLElement>(
      "[data-material-actions]",
    );
    if (bottom === null) throw new Error("Bottom actions are missing");
    const topRead = within(top).getByRole("button", { name: "Изучено" });
    const bottomRead = within(bottom).getByRole("button", { name: "Изучено" });
    await waitFor(async () =>
      expect(topRead).toHaveAttribute("aria-pressed", "false"),
    );
    topRead.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(async () => {
      await expect(topRead).toHaveAttribute("aria-disabled", "true");
      await expect(bottomRead).toHaveAttribute("aria-disabled", "true");
    });
    if (release === undefined)
      throw new Error("Reading save was not submitted");
    release();
    await waitFor(async () => {
      await expect(topRead).toHaveAttribute("aria-pressed", "true");
      await expect(bottomRead).toHaveAttribute("aria-pressed", "true");
    });
    const topBookmark = within(top).getByRole("button", { name: "В закладки" });
    await userEvent.click(topBookmark);
    await waitFor(async () => {
      await expect(
        within(top).getByRole("button", { name: "В закладках" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        within(bottom).getByRole("button", { name: "В закладках" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    await userEvent.click(
      within(bottom).getByRole("button", { name: "В закладках" }),
    );
    await waitFor(async () =>
      expect(
        within(top).getByRole("button", { name: "В закладки" }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    await expect(canvas.queryByText("Сложность: Базовый")).toBeNull();
  },
};
export const SyncedActionsMobile: Story = {
  ...SyncedActions,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
