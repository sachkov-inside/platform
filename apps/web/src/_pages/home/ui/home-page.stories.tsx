import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { MaterialPreview } from "@/entities/material";
import { ApplicationShell } from "@/widgets/application-shell";
import type { HomeView } from "../model/home-view";
import { HomePage } from "./home-page";
import { illustratedHome } from "./illustrated-home.fixture";

const video = material({
  format: "Видео",
  primaryVideoDurationSeconds: 754,
  slug: "video-pro-developer-pipeline",
  title: "Видео про Developer Pipeline",
});
const guide = material({
  format: "Гайд",
  slug: "kak-ustroen-inside-platform",
  title: "Как устроен Inside Platform",
});
const note = material({
  publishedAt: "2026-09-07T09:00:00.000Z",
  format: "Заметка",
  slug: "zametka-pro-granitsy-modulya",
  title: "Границы хорошего модуля",
});
const home = {
  membership: { kind: "active" },
  guides: [guide],
  notes: [note],
  playlists: [
    {
      count: 3,
      cover: null,
      id: "72000000-0000-4000-8000-000000000007",
      name: "Создание Platform Inside",
      previewItems: [video, guide, note],
      slug: "platform-inside",
      summary: "Путь от продуктовой идеи до работающей Platform.",
    },
  ],
  topics: [
    {
      count: 5,
      cover: null,
      id: "72000000-0000-4000-8000-000000000002",
      name: "Platform",
      previewItems: [guide],
      slug: "platform",
      summary: "Архитектура продукта и управляемая поставка.",
    },
  ],
  videos: [
    video,
    material({
      format: "Видео",
      primaryVideoDurationSeconds: 481,
      slug: "video-pro-glubokie-moduli",
      title: "Глубокие модули на практике",
    }),
  ],
} as const satisfies HomeView;

const meta = {
  component: HomePage,
  decorators: [
    (Story) => (
      <ApplicationShell
        currentPath="/"
        mobileNavigationItems={[
          { href: "/", icon: "home", label: "Главная" },
          { href: "/library", icon: "library", label: "База знаний" },
          { href: "/account", icon: "profile", label: "Профиль" },
        ]}
        navigationItems={[
          { href: "/", icon: "home", label: "Главная" },
          { href: "/library", icon: "library", label: "База знаний" },
        ]}
      >
        <Story />
      </ApplicationShell>
    ),
  ],
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  title: "Pages/Mobile-first Platform/Home",
} satisfies Meta<typeof HomePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RealDataReady: Story = {
  args: { result: { kind: "ready", value: home } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Главная" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Новые видео" })).toBeVisible();
    await expect(canvas.getByText("12:34")).toBeVisible();
    const topicLink = canvas.getByRole("link", { name: "Platform" });
    await expect(topicLink).toHaveAttribute("href", "/topics/platform?from=%2F");
    await expect(canvas.queryByRole("complementary", { name: "Подписка Inside" })).not.toBeInTheDocument();
    await expect(canvas.queryByText(/продолжить/iu)).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Все видео" })).toHaveAttribute(
      "href",
      "/library?format=video",
    );
    await expect(canvas.getByRole("link", { name: "Все гайды" })).toHaveAttribute(
      "href",
      "/library?format=guide",
    );
    await expect(canvas.getByRole("link", { name: "Все заметки" })).toHaveAttribute(
      "href",
      "/library?format=note",
    );
    const noteFeed = canvas.getByRole("list", { name: "Лента заметок" });
    await expect(noteFeed).toBeVisible();
    await expect(noteFeed).not.toHaveClass("divide-y");
    await expect(within(noteFeed).getByRole("article")).toHaveClass(
      "rounded-[1.5rem]",
      "border",
      "bg-card",
    );
    const seriesHeading = canvas.getByRole("heading", { name: "Серии" });
    const videosHeading = canvas.getByRole("heading", { name: "Новые видео" });
    await expect(
      Boolean(
        seriesHeading.compareDocumentPosition(videosHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  },
};

export const Unavailable: Story = {
  args: { result: { kind: "unavailable" } },
};

export const IllustratedCatalog: Story = {
  args: { result: { kind: "ready", value: illustratedHome } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const topic = canvas.getByRole("link", { name: "Архитектура" });
    await expect(topic).toBeVisible();
    const playlist = canvas.getByRole("link", { name: "Открыть серию Создание Platform Inside" });
    await expect(playlist.querySelectorAll("[data-content-cover-id]")).toHaveLength(2);
  },
};

export const NotesPreview: Story = {
  args: { result: { kind: "ready", value: { ...home, notes: [note, { ...note, slug: "last-note", title: "Маленький релиз проще проверить" }] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const feed = canvas.getByRole("list", { name: "Лента заметок" });
    await expect(within(feed).getByRole("link", { name: note.title })).toBeVisible();
    await expect(within(feed).queryByRole("link", { name: "Маленький релиз проще проверить" })).not.toBeInTheDocument();
    await expect(within(feed).getByRole("link", { name: "Все заметки" })).toHaveAttribute("href", "/library?format=note");
    await expect(feed.querySelector("time")).toHaveAttribute("datetime", "2026-09-07T09:00:00.000Z");
    await expect(feed.querySelector("[inert]")).toHaveAttribute("aria-hidden", "true");
  },
};

function material(
  input: Pick<MaterialPreview, "format" | "slug" | "title"> &
    Partial<MaterialPreview>,
): MaterialPreview {
  const { format, slug, title, ...overrides } = input;
  return {
    access: "free",
    availability: "available",
    cover: null,
    format,
    seriesMemberships: [],
    slug,
    summary: "Production-компонент получает только безопасную проекцию API.",
    tags: ["Full stack"],
    title,
    topic: "Platform",
    topicSlug: "platform",
    ...overrides,
  };
}
