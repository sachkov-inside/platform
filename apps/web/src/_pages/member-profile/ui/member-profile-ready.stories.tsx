import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import type { ProfileReportState } from "@/_pages/account";

import { MemberProfileReady } from "./member-profile-ready";

const profile = {
  bio: "Развиваю инженерные команды и изучаю agent-first delivery.",
  displayName: "Кирилл Сачков",
  publicProfileId: "5d34da22-548e-4b02-b6e8-9c918ad536ef",
} as const;

function reportAccepted(): Promise<ProfileReportState> {
  return Promise.resolve({ duplicate: false, kind: "reported" });
}

const meta = {
  args: { profile, reportAction: reportAccepted },
  component: MemberProfileReady,
  parameters: {
    docs: {
      description: {
        component:
          "Active-member projection contains only the accepted Profile fields and a bounded text-report control.",
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
    await userEvent.click(
      canvas.getByText("Сообщить о тексте профиля", { selector: "summary" }),
    );
    await expect(canvas.getByText("Причина")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Отправить жалобу" }));
    await expect(
      canvas.getByText("Жалоба принята для ручной проверки."),
    ).toBeInTheDocument();
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
    await expect(canvas.getByText("Сообщить о тексте профиля")).toBeInTheDocument();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
