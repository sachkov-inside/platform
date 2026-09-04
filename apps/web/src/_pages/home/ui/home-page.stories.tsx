import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { MaterialPreview } from "@/entities/material";
import { ApplicationShell } from "@/widgets/application-shell";
import type { HomeView } from "../model/home-view";
import { HomePage } from "./home-page";

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
  format: "Заметка",
  slug: "zametka-pro-granitsy-modulya",
  title: "Границы хорошего модуля",
});
const home = {
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
    const topicCard = canvas.getByRole("link", { name: "Открыть тему Platform" });
    await expect(topicCard).toHaveAttribute("data-topic-card");
    await expect(within(topicCard).queryByText("5", { exact: true })).not.toBeInTheDocument();
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
    await expect(canvas.getByRole("list", { name: "Лента заметок" })).toBeVisible();
  },
};

export const Unavailable: Story = {
  args: { result: { kind: "unavailable" } },
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
