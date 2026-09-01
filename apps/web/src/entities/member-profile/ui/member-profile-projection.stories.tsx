import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { MemberProfileProjection } from "./member-profile-projection";

const meta = {
  args: {
    fields: {
      avatar: null,
      bio: "Проектирую устойчивые процессы разработки и делюсь практикой.",
      displayName: "Анна",
    },
    headingLevel: "h1",
    label: "Участник сообщества",
  },
  component: MemberProfileProjection,
  parameters: {
    docs: {
      description: {
        component:
          "The exact active-member projection reused by the owner preview and `/members/[publicProfileId]`.",
      },
    },
  },
  title: "Pages/Member profile/Production projection",
} satisfies Meta<typeof MemberProfileProjection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBio: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Анна" })).toBeInTheDocument();
    await expect(canvas.getByText(/устойчивые процессы/iu)).toBeInTheDocument();
  },
};

export const WithoutBio: Story = {
  args: { fields: { avatar: null, bio: null, displayName: "Анна" } },
};

export const LongUnbrokenName: Story = {
  args: {
    fields: {
      avatar: null,
      bio: "Проверка переноса длинного имени на узком экране.",
      displayName: "ОченьДлинноеНеразрывноеИмяУчастникаСообществаБезПробелов",
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const article = within(canvasElement).getByRole("article");
    await expect(article.scrollWidth).toBeLessThanOrEqual(article.clientWidth);
  },
};
