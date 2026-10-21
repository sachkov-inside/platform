import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  localAccountsContent,
  localAccountsStyles,
} from "../../../../scripts/local-accounts-view.mjs";

function LocalAccounts(view: { choice: string; returnTo: string }) {
  return (
    <>
      <style>{localAccountsStyles}</style>
      <div
        lang="ru"
        dangerouslySetInnerHTML={{ __html: localAccountsContent(view) }}
      />
    </>
  );
}
const meta = {
  title: "Patterns/Local stand/Accounts",
  component: LocalAccounts,
  args: { choice: "owner", returnTo: "/" },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Локальный выбор реального проверочного Account. Одна presentation-функция со шлюзом; fixtures не подключаются к Logto. Temporary semantic UI #1641, visual integration #1642.",
      },
    },
  },
} satisfies Meta<typeof LocalAccounts>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = {
  name: "Владелец",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("radio")).toHaveLength(4);
    await expect(canvas.getByRole("radio", { name: /Владелец/ })).toBeChecked();
    await expect(
      canvas.getByRole("button", { name: "Выбрать аккаунт" }),
    ).toBeVisible();
  },
};
export const LearnerWithAccess: Story = {
  name: "Ученик с доступом",
  args: { choice: "learner-with-access" },
};
export const LearnerWithoutAccess: Story = {
  name: "Ученик без доступа",
  args: { choice: "learner" },
};
export const Guest: Story = { name: "Гость", args: { choice: "guest" } };
