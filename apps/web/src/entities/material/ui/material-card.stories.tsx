import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";
import { MaterialCard } from "./material-card";

const meta = {
  ...publicPageEnvironment("/"),
  title: "Entities/Material Card",
  component: MaterialCard,
  args: {
    variant: "feed",
    material: {
      access: "free",
      availability: "available",
      format: "Гайд",
      seriesMemberships: [],
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
        (["feed", "row", "series"] as const).map((variant) => (
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
    await expect(canvas.getAllByRole("article")).toHaveLength(6);
    await expect(
      canvas.queryByRole("button", { name: /Поделиться материалом/ }),
    ).not.toBeInTheDocument();
  },
};
export const WithoutSharingMobile: Story = {
  ...WithoutSharing,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
