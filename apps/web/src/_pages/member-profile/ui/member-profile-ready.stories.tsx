import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { MemberProfileReady } from "./member-profile-ready";

const profile = {
  bio: "Развиваю инженерные команды и изучаю agent-first delivery.",
  displayName: "Кирилл Сачков",
  publicProfileId: "5d34da22-548e-4b02-b6e8-9c918ad536ef",
} as const;

const meta = {
  args: { profile },
  component: MemberProfileReady,
  parameters: {
    docs: {
      description: {
        component:
          "Active-member projection contains only the accepted Profile fields.",
      },
    },
  },
  title: "Pages/Member Profile/Production",
} satisfies Meta<typeof MemberProfileReady>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Active · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: profile.displayName }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(profile.bio)).toBeInTheDocument();
    await expect(canvas.queryByText(/email|telegram/iu)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/жалоб|сообщить о тексте/iu)).not.toBeInTheDocument();
  },
};

export const ActiveMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Active · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: profile.displayName }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/жалоб|сообщить о тексте/iu)).not.toBeInTheDocument();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
