import { useState, type ComponentProps } from "react";
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
let readingFailure: "unavailable" | "denied" | "conflict" | null = null;
let bookmarkFailure: "unavailable" | "denied" | null = null;
let initialReadFailure = false;
const initialReadReleases: (() => void)[] = [];
const commands: string[] = [];
function releaseReading() {
  if (release === undefined) throw new Error("Reading save was not submitted");
  release();
}
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
    readingFailure = null;
    bookmarkFailure = null;
    initialReadFailure = false;
    initialReadReleases.length = 0;
    commands.length = 0;
    return fetchBeforeRender(async (input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      if (
        initialReadFailure &&
        ["/api/reading-progress/states", "/api/bookmarks/states"].includes(path)
      ) {
        await new Promise<void>((resolve) => {
          initialReadReleases.push(resolve);
        });
        return Response.json({ kind: "unavailable" }, { status: 503 });
      }
      if (path === "/api/reading-progress/states")
        return Response.json({ kind: "ready", states: [readingState()] });
      if (path === "/api/bookmarks/states")
        return Response.json({ kind: "ready", states: [bookmarkState()] });
      const body =
        input instanceof Request ? await input.formData() : init?.body;
      if (!(body instanceof FormData))
        throw new Error(`Unexpected request: ${path}`);
      if (path === "/api/reading-progress/state") {
        const commandId = body.get("commandId");
        if (typeof commandId !== "string")
          throw new Error("Missing command ID");
        commands.push(commandId);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (readingFailure !== null)
          return Response.json(
            readingFailure === "conflict"
              ? { kind: "conflict", current: readingState() }
              : { kind: readingFailure },
          );
        isRead = body.get("isRead") === "true";
        version += 1;
        return Response.json({
          kind: "saved",
          state: readingState(),
          replayed: false,
        });
      }
      if (path === "/api/bookmarks/state") {
        if (bookmarkFailure !== null)
          return Response.json({ kind: bookmarkFailure });
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

export const InitialReadFailureKeepsHeaderPlace: Story = {
  beforeEach: () => {
    initialReadFailure = true;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByRole("navigation", {
      name: "Действия материала",
    });
    const header = canvasElement.querySelector("[data-reader-header]");
    if (header === null) throw new Error("Reader header is missing");
    await waitFor(() => expect(initialReadReleases).toHaveLength(2));
    const before = header.getBoundingClientRect().top;
    for (const releaseRead of initialReadReleases) releaseRead();
    await waitFor(() =>
      expect(within(top).getAllByRole("alert")).toHaveLength(2),
    );
    await expect(
      Math.abs(header.getBoundingClientRect().top - before),
    ).toBeLessThanOrEqual(1);
    initialReadFailure = false;
    await userEvent.click(within(top).getByRole("button", { name: "Изучено" }));
    await waitFor(() =>
      expect(top.querySelector("[data-reading-action-state]")).toHaveAttribute(
        "data-reading-action-state",
        "ready",
      ),
    );
    await userEvent.click(
      within(top).getByRole("button", { name: "В закладки" }),
    );
    await waitFor(() =>
      expect(top.querySelector("[data-bookmark-action-state]")).toHaveAttribute(
        "data-bookmark-action-state",
        "ready",
      ),
    );
    await expect(commands).toHaveLength(0);
    await expect(
      within(top).getByRole("button", { name: "В закладки" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};
export const InitialReadFailureKeepsHeaderPlaceMobile: Story = {
  ...InitialReadFailureKeepsHeaderPlace,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const SharedFailureAndRetry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByRole("navigation", {
      name: "Действия материала",
    });
    const bottom = canvasElement.querySelector<HTMLElement>(
      "[data-material-actions]",
    );
    if (bottom === null) throw new Error("Bottom actions are missing");
    const reads = [
      within(top).getByRole("button", { name: "Изучено" }),
      within(bottom).getByRole("button", { name: "Изучено" }),
    ] as const;
    const save = async (button: HTMLElement) => {
      release = undefined;
      await userEvent.click(button);
      await waitFor(() => expect(release).toBeDefined());
      releaseReading();
    };
    readingFailure = "unavailable";
    await save(reads[0]);
    await waitFor(async () => {
      await expect(
        top.querySelector("[data-reading-action-state]"),
      ).toHaveAttribute("data-reading-action-state", "error");
      await expect(
        bottom.querySelector("[data-reading-action-state]"),
      ).toHaveAttribute("data-reading-action-state", "error");
    });
    readingFailure = null;
    await save(reads[1]);
    await waitFor(async () => {
      for (const button of reads)
        await expect(button).toHaveAttribute("aria-pressed", "true");
    });
    await expect(commands[1]).toBe(commands[0]);
    await save(reads[0]);
    await waitFor(async () => {
      for (const button of reads)
        await expect(button).toHaveAttribute("aria-pressed", "false");
    });
    await expect(commands[2]).not.toBe(commands[0]);
    bookmarkFailure = "unavailable";
    await userEvent.click(
      within(top).getByRole("button", { name: "В закладки" }),
    );
    await waitFor(async () => {
      await expect(
        bottom.querySelector("[data-bookmark-action-state]"),
      ).toHaveAttribute("data-bookmark-action-state", "error");
    });
    bookmarkFailure = null;
    await userEvent.click(
      within(bottom).getByRole("button", { name: "В закладки" }),
    );
    await waitFor(() =>
      expect(top.querySelector("[data-bookmark-action-state]")).toHaveAttribute(
        "data-bookmark-action-state",
        "ready",
      ),
    );
    await userEvent.click(
      within(top).getByRole("button", { name: "В закладках" }),
    );
    await waitFor(() =>
      expect(
        within(bottom).getByRole("button", { name: "В закладки" }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
  },
};

export const SharedConflictAndDenial: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = await canvas.findByRole("navigation", {
      name: "Действия материала",
    });
    const bottom = canvasElement.querySelector<HTMLElement>(
      "[data-material-actions]",
    );
    if (bottom === null) throw new Error("Bottom actions are missing");
    const save = async () => {
      release = undefined;
      await userEvent.click(
        within(top).getByRole("button", { name: "Изучено" }),
      );
      await waitFor(() => expect(release).toBeDefined());
      releaseReading();
    };
    readingFailure = "conflict";
    await save();
    await waitFor(() =>
      expect(
        within(bottom).getByRole("button", { name: "Обновить статус" }),
      ).toBeVisible(),
    );
    await userEvent.click(
      within(bottom).getByRole("button", { name: "Обновить статус" }),
    );
    await waitFor(() =>
      expect(
        within(top).queryByRole("button", { name: "Обновить статус" }),
      ).toBeNull(),
    );
    readingFailure = "denied";
    await save();
    await waitFor(async () => {
      for (const root of [top, bottom])
        await expect(
          within(root).getByRole("button", { name: "Изучено" }),
        ).toHaveAttribute("aria-disabled", "true");
    });
    bookmarkFailure = "denied";
    await userEvent.click(
      within(top).getByRole("button", { name: "В закладки" }),
    );
    await waitFor(async () => {
      for (const root of [top, bottom])
        await expect(
          root.querySelector("[data-bookmark-action-state]"),
        ).toHaveAttribute("data-bookmark-action-state", "denied");
    });
  },
};

function GrowingReader(args: ComponentProps<typeof MaterialReaderView>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        className="min-h-11 text-sm"
        onClick={() => {
          setExpanded(true);
        }}
        type="button"
      >
        Показать длинный материал
      </button>
      <MaterialReaderView
        {...args}
        body={
          expanded
            ? args.body
            : [
                {
                  kind: "paragraph",
                  content: [
                    { kind: "text", marks: [], text: "Короткий материал." },
                  ],
                },
              ]
        }
      />
    </>
  );
}
export const ToolbarKeepsHeaderPlace: Story = {
  render: (args) => <GrowingReader {...args} />,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector("[data-reader-header]");
    if (header === null) throw new Error("Reader header is missing");
    const toolbar = canvas.getByRole("navigation", {
      name: "Действия материала",
    });
    await expect(toolbar).toBeVisible();
    await expect(
      header.getBoundingClientRect().top -
        toolbar.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(24);
    const before = header.getBoundingClientRect().top;
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать длинный материал" }),
    );
    await canvas.findByRole("navigation", { name: "Действия материала" });
    await expect(
      Math.abs(header.getBoundingClientRect().top - before),
    ).toBeLessThanOrEqual(1);
  },
};
export const ToolbarKeepsHeaderPlaceMobile: Story = {
  ...ToolbarKeepsHeaderPlace,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const StandaloneActionsMobile: Story = {
  args: { seriesContext: null },
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    const toolbar = within(canvasElement).getByRole("navigation", {
      name: "Действия материала",
    });
    await expect(
      within(toolbar).getByRole("link", { name: "Назад к программе" }),
    ).toBeVisible();
    await expect(
      within(toolbar).queryByRole("link", { name: "Назад" }),
    ).toBeNull();
    await expect(toolbar.getBoundingClientRect().height).toBeLessThanOrEqual(
      104,
    );
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};
