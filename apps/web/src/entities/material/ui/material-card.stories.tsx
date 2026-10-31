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
