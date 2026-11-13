import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialCard } from "./material-card";

const meta = {
  ...publicPageEnvironment("/"),
  id: "entities-material-card",
  title: "Components/Material/Card",
  component: MaterialCard,
  args: {
    variant: "feed",
    material: {
      access: "free",
      availability: "available",
      format: "Гайд",
      productMemberships: [],
      slug: "public-material",
      summary: "Материал для самостоятельного чтения.",
      tags: [],
      title: "Публичный материал",
      topic: "AI Engineering",
      topicSlug: "ai-engineering",
    },
  },
} satisfies Meta<typeof MaterialCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithoutSharing: Story = {
  render: (args) => (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4">
      {(["free", "closed"] as const).flatMap((access) =>
        (["feed", "row", "product", "library"] as const).map((variant) => (
          <MaterialCard
            {...args}
            key={`${access}-${variant}`}
            material={{ ...args.material, access }}
            variant={variant}
          />
        )),
      )}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("article")).toHaveLength(8);
    await expect(
      canvas.queryByRole("button", { name: /Поделиться материалом/ }),
    ).not.toBeInTheDocument();
  },
};
export const WithoutSharingMobile: Story = {
  ...WithoutSharing,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Бесплатный урок курса у гостя (#1825): закрыт до входа через Telegram, но помечен бесплатным. */
export const FreeLessonForGuest: Story = {
  render: (args) => (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4">
      {(["feed", "row"] as const).map((variant) => (
        <MaterialCard
          {...args}
          key={variant}
          material={{
            ...args.material,
            access: "free",
            availability: "locked",
          }}
          variant={variant}
        />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Для участников")).not.toBeInTheDocument();
    await expect(canvas.queryByText("По подписке")).not.toBeInTheDocument();
    await expect(canvas.getAllByText("Бесплатно").length).toBeGreaterThan(0);
  },
};

/** Открытый материал ленты (#1885): карточка без размытия и метки доступа. */
export const FeedCardIsOpen: Story = {
  args: {
    material: {
      ...meta.args.material,
      cover: {
        coverId: "94000000-0000-4000-8000-000000000061",
        renditions: [{ width: 640, height: 360 }],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Материал для самостоятельного чтения."),
    ).toBeVisible();
    await expect(canvas.queryByText("Бесплатно")).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector("[data-access-cover]"),
    ).not.toBeInTheDocument();
    await expect(canvasElement.querySelector(".blur-\\[4px\\]")).toBeNull();
  },
};

/** Формат на карточке каталога (решение владельца 13.11.2026): видео и текст, с обложкой и без. */
export const LibraryFormats: Story = {
  render: (args) => {
    const cover = {
      coverId: "27100000-0000-4000-8000-000000000005",
      renditions: [{ width: 960, height: 540 }],
    };
    const cards = [
      {
        slug: "video-cover",
        title: "Выбор агента и модели",
        format: "Видео",
        formatSlug: "video",
        primaryVideoDurationSeconds: 563,
        cover,
      },
      {
        slug: "video-guide",
        title: "Проектирование с агентом через grilling",
        format: "Гайд",
        formatSlug: "guide",
        primaryVideoDurationSeconds: 1420,
      },
      {
        slug: "text",
        title: "Как передавать правила исполнителю и ревьюеру",
        format: "Гайд",
        formatSlug: "guide",
      },
      {
        slug: "text-cover",
        title: "Как работать с агентом в существующем проекте",
        format: "Гайд",
        formatSlug: "guide",
        cover: { ...cover, coverId: "27100000-0000-4000-8000-000000000009" },
      },
    ] as const;
    return (
      <ul className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-x-4 gap-y-5 p-4 sm:grid-cols-4">
        {cards.map((card) => (
          <li className="min-w-0" key={card.slug}>
            <MaterialCard
              {...args}
              material={{ ...args.material, ...card }}
              variant="library"
            />
          </li>
        ))}
      </ul>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Видео · 9:23")).toBeVisible();
    await expect(canvas.getByText("Видео · 23:40")).toBeVisible();
    await expect(canvas.getAllByText("Текст")).toHaveLength(2);
    await expect(canvas.queryByText("Гайд")).not.toBeInTheDocument();
  },
};
export const LibraryFormatsMobile: Story = {
  ...LibraryFormats,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
