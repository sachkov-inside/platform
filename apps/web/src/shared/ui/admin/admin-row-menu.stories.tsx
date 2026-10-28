import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { internalRoute } from "@/shared/routing/internal-route";

import { AdminRowMenu } from "./admin-row-menu.client";
import { ReasonDialog } from "./reason-dialog.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const publish = fn();
const remove = fn();

const meta = {
  title: "Components/Админка/AdminRowMenu",
  component: AdminRowMenu,
  parameters: { layout: "padded" },
  args: {
    label: "Действия с «Ревью кода с агентом»",
    items: [
      {
        id: "preview",
        label: "Предпросмотр",
        href: internalRoute("/authoring/materials/material-2/preview"),
      },
      { id: "publish", label: "Опубликовать", onSelect: publish },
      {
        id: "archive",
        label: "Перенести в архив",
        disabled: true,
      },
      {
        id: "delete",
        label: "Удалить черновик",
        tone: "danger",
        onSelect: remove,
      },
    ],
  },
  beforeEach: () => {
    publish.mockClear();
    remove.mockClear();
  },
  decorators: [
    (Story) => (
      <div className="flex justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AdminRowMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const KeyboardDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Действия с «Ревью кода с агентом»",
    });
    await expect(trigger).toHaveAttribute("data-row-action");
    await expect(trigger.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      32,
    );
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const body = within(document.body);
    const menu = await body.findByRole("menu");
    await expect(
      within(menu).getByRole("menuitem", { name: "Предпросмотр" }),
    ).toHaveAttribute("href", "/authoring/materials/material-2/preview");
    await expect(
      within(menu).getByRole("menuitem", { name: "Перенести в архив" }),
    ).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Опубликовать" }),
    );
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await expect(trigger).toHaveFocus();
  },
};

export const TouchMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Действия с «Ревью кода с агентом»",
    });
    await userEvent.click(trigger);
    const item = await within(document.body).findByRole("menuitem", {
      name: "Удалить черновик",
    });
    await expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      40,
    );
    await userEvent.click(item);
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  },
};

const revoke = fn();

/** Пункт меню открывает диалог; после закрытия диалога фокус снова на «⋯». */
function MenuWithDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AdminRowMenu
        items={[
          {
            id: "revoke",
            label: "Отозвать доступ",
            tone: "danger",
            onSelect: () => {
              setOpen(true);
            },
          },
        ]}
        label="Действия с «Анна Смирнова»"
      />
      <ReasonDialog
        confirmLabel="Отозвать доступ"
        onConfirm={revoke}
        onOpenChange={setOpen}
        open={open}
        reasons={[
          { value: "refund", label: "Возврат оплаты" },
          { value: "other", label: "Другое" },
        ]}
        otherValue="other"
        title="Отозвать доступ к «AI Engineering»?"
        tone="danger"
      />
    </>
  );
}

export const OpensDialogDesktop: Story = {
  ...desktop,
  render: () => <MenuWithDialog />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Действия с «Анна Смирнова»",
    });
    await userEvent.click(trigger);
    const body = within(document.body);
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Отозвать доступ" }),
    );
    const dialog = await body.findByRole("dialog", {
      name: "Отозвать доступ к «AI Engineering»?",
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Отмена" }),
      ).toHaveFocus(),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeVisible());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const OpensDialogMobile: Story = {
  ...OpensDialogDesktop,
  ...mobile,
};
