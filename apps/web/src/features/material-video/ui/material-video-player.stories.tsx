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
  id: "components-material-video-player",
  title: "Components/Material/Video player",
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

export const MaterialCoverPoster: Story = {
  args: {
    cover: {
      coverId: "27100000-0000-4000-8000-000000000001",
      renditions: [{ width: 960, height: 540 }],
    },
    showPoster: true,
    onStart: fn(),
    phase: "playing",
  },
  name: "Player · Material cover before start",
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const start = canvas.getByRole("button", {
      name: `Смотреть видео: ${args.title}`,
    });
    await expect(start).toBeVisible();
    start.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onStart).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    await expect(args.onStart).toHaveBeenCalledTimes(2);
    await userEvent.click(start);
    await expect(args.onStart).toHaveBeenCalledTimes(3);
  },
};

export const MaterialCoverAfterStart: Story = {
  args: { ...MaterialCoverPoster.args, showPoster: false, phase: "playing" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("button", { name: /Смотреть видео/ }),
    ).toBeNull();
  },
};

export const MaterialCoverError: Story = {
  args: { ...MaterialCoverPoster.args, phase: "error" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: /Смотреть видео/ }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(args.onLoad).toHaveBeenCalled();
  },
};

export const PlayerManyChapters: Story = {
  args: {
    activeChapter: 0,
    chapters: [
      { start: 0, title: "Вступление" },
      { start: 14, title: "Выбор зависит от цели" },
      { start: 45, title: "Claude и ChatGPT: оплата и аккаунты" },
      { start: 115, title: "Какая подписка для каких задач" },
      { start: 141, title: "Мой совет: ChatGPT или Claude" },
      { start: 224, title: "DeepSeek для учёбы" },
      { start: 299, title: "DeepSeek в агентах и DeepSeek Harness" },
      { start: 343, title: "GLM, Kimi и Qwen" },
      { start: 406, title: "Итог: с чего начать" },
      { start: 471, title: "Связка ChatGPT и DeepSeek" },
      { start: 536, title: "Вопросы в группе и подписка от работодателя" },
    ],
  },
  name: "Player · scrollable chapters",
};
