import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { flushSync } from "react-dom";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { AdminDialog, AdminConfirmDialog } from "./admin-dialog.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const meta = {
  title: "Components/Админка/AdminConfirmDialog",
  component: AdminConfirmDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    title:
      "Отозвать ссылку на «Агентная разработка: от первого агента до команды агентов»?",
    consequence:
      "Оплатить по ссылке будет нельзя. Цена 16 915 ₽, по 15 нояб. 2026. Покупатель увидит, что ссылка отозвана.",
    confirmLabel: "Отозвать ссылку",
    tone: "danger",
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AdminConfirmDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DangerDesktop: Story = {
  ...desktop,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await expect(
      within(dialog).getByRole("button", { name: "Отмена" }),
    ).toHaveFocus();
  },
};

/** На телефоне это лист снизу во всю ширину. */
export const DangerMobile: Story = { ...DangerDesktop, ...mobile };

export const WithError: Story = {
  ...mobile,
  args: {
    error:
      "Ссылка изменилась в другом месте. Обновите данные и проверьте её состояние.",
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await expect(within(dialog).getByRole("alert")).toBeVisible();
  },
};

function RetainedDialog({
  pendingInitially = false,
}: {
  readonly pendingInitially?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("Черновик");
  const [mounted, setMounted] = useState(true);
  const [pending, setPending] = useState(pendingInitially);
  return (
    <>
      <button
        onClick={() => {
          setVisible(true);
        }}
        type="button"
      >
        Вернуться к форме
      </button>
      <output aria-label="Состояние формы">
        {open ? "Открыта" : "Закрыта"}
      </output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <AdminDialog
            pending={pending}
            open={open}
            onOpenChange={setOpen}
            title="Сохранённая форма"
          >
            <label>
              Название
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                }}
              />
            </label>
            <button
              onClick={() => {
                setVisible(false);
              }}
              type="button"
            >
              Перейти к другой странице
            </button>
            <button
              onClick={() => {
                setPending(false);
              }}
              type="button"
            >
              Операция завершилась
            </button>
            <button
              onClick={() => {
                setMounted(false);
              }}
              type="button"
            >
              Удалить форму
            </button>
          </AdminDialog>
        ) : null}
      </Activity>
    </>
  );
}

export const RetainedModalLifetime: Story = {
  render: () => <RetainedDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Сохранённая форма",
    });
    await expect(dialog.matches(":modal")).toBe(true);
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Название" }),
      " сохранён",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Перейти к другой странице" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await expect(dialog).toBeInTheDocument();
    await expect(canvas.getByLabelText("Состояние формы")).toHaveTextContent(
      "Открыта",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуться к форме" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(
      canvas.getByRole("dialog", { name: "Сохранённая форма" }),
    ).toBe(dialog);
    await expect(
      within(dialog).getByRole("textbox", { name: "Название" }),
    ).toHaveValue("Черновик сохранён");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await expect(canvas.getByLabelText("Состояние формы")).toHaveTextContent(
      "Закрыта",
    );
  },
};

export const RetainedPendingLifetime: Story = {
  render: () => <RetainedDialog pendingInitially />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Сохранённая форма",
    });
    await userEvent.keyboard("{Escape}");
    await expect(dialog.matches(":modal")).toBe(true);
    await expect(
      within(dialog).getByRole("button", { name: /^Закрыть$/ }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Перейти к другой странице" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await expect(canvas.getByLabelText("Состояние формы")).toHaveTextContent(
      "Открыта",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуться к форме" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await userEvent.keyboard("{Escape}");
    await expect(dialog.matches(":modal")).toBe(true);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Операция завершилась" }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
  },
};

export const UnmountedModalLifetime: Story = {
  render: () => <RetainedDialog />,
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement).findByRole<HTMLDialogElement>(
      "dialog",
      { name: "Сохранённая форма" },
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Удалить форму" }),
    );
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expect(dialog.open).toBe(false);
    await expect(dialog.matches(":modal")).toBe(false);
  },
};

export const QueuedLifetimeCloses: Story = {
  render: () => <RetainedDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Сохранённая форма",
    });
    const hide = within(dialog).getByRole("button", {
      name: "Перейти к другой странице",
    });
    const show = canvas.getByRole("button", { name: "Вернуться к форме" });
    let closed = 0;
    const acknowledged = Promise.withResolvers<undefined>();
    const onClose = () => {
      closed += 1;
      if (closed === 2) acknowledged.resolve(undefined);
    };
    dialog.addEventListener("close", onClose);
    try {
      // Two actual hidden lifetimes finish before either queued native close dispatches.
      flushSync(() => {
        hide.click();
      });
      flushSync(() => {
        show.click();
      });
      flushSync(() => {
        hide.click();
      });
      await acknowledged.promise;
      await expect(dialog.matches(":modal")).toBe(false);
      await expect(canvas.getByLabelText("Состояние формы")).toHaveTextContent(
        "Открыта",
      );
      await userEvent.click(show);
      await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    } finally {
      dialog.removeEventListener("close", onClose);
    }
  },
};
