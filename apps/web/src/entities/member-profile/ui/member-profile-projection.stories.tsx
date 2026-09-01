import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { MemberProfileProjection } from "./member-profile-projection";

const meta = {
  args: {
    fields: {
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
  args: { fields: { bio: null, displayName: "Анна" } },
};
