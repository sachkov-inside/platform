import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";

import { MaterialVideoPlayerView } from "./material-primary-video.client";

/**
 * Плеер основного видео на странице материала. Отметку о просмотре маршрут ставит под уроком,
 * поэтому плеер, как в `MaterialReaderView`, показывается без своей кнопки.
 */
const meta = {
  ...publicPageEnvironment("/materials/agent-first-skills"),
  component: MaterialVideoPlayerView,
  args: {
    className: "max-w-none",
    onLoad: fn(),
    phase: "loading",
    showWatchedAction: false,
    title: "Разбор проверки skill contract",
    videoId: "03000000-0000-4000-8000-000000000001",
  },
  title: "Components/Material video/Player",
} satisfies Meta<typeof MaterialVideoPlayerView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PlayerErrorAndRetry: Story = {
  args: { phase: "error" },
  name: "Player · error and retry",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Не удалось загрузить видео")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Повторить" }),
    ).toBeEnabled();
  },
};

export const PlayerChapters: Story = {
  args: {
    activeChapter: 75,
    chapters: [
      { start: 0, title: "Введение" },
      { start: 75, title: "Проверка результата" },
    ],
  },
  name: "Player · chapters and current timestamp",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const navigation = within(
      canvas.getByRole("navigation", { name: "Главы видео" }),
    );
    const chapter = navigation.getByRole("link", {
      name: "1:15 Проверка результата",
    });
    await expect(chapter).toHaveAttribute("aria-current", "true");
    await expect(
      navigation.getByRole("link", { name: "0:00 Введение" }),
    ).not.toHaveAttribute("aria-current");
    await expect(chapter).toHaveAttribute("href", "#t=75");
    const view = canvasElement.ownerDocument.defaultView;
    if (view === null) throw new Error("Story canvas has no window");
    const originalUrl = view.location.href;
    const onHashChange = fn();
    // The test runner frame must not navigate; the component handler still runs first.
    const stayOnPage = (event: MouseEvent) => {
      event.preventDefault();
    };
    try {
      view.history.replaceState(null, "", "#t=75");
      view.addEventListener("click", stayOnPage);
      view.addEventListener("hashchange", onHashChange);
      await userEvent.click(chapter);
      await waitFor(async () => {
        await expect(onHashChange).toHaveBeenCalled();
      });
    } finally {
      view.removeEventListener("hashchange", onHashChange);
      view.removeEventListener("click", stayOnPage);
      view.history.replaceState(null, "", originalUrl);
    }
  },
};
