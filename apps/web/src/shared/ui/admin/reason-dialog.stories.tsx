import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { Button } from "@/shared/ui/button";

import { touchTarget } from "./admin.fixtures";
import { ReasonDialog, type ReasonDialogProps } from "./reason-dialog.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const confirm = fn();

/** Страница держит открытие диалога; кнопка открывает его снова после закрытия. */
function DialogHost(props: ReasonDialogProps) {
  const [open, setOpen] = useState(props.open);
  return (
    <>
      <Button
        className="min-h-11 px-4"
        onClick={() => {
          setOpen(true);
        }}
        type="button"
        variant="outline"
      >
        Отозвать
      </Button>
      <ReasonDialog {...props} onOpenChange={setOpen} open={open} />
    </>
  );
}

const meta = {
  title: "Components/Админка/ReasonDialog",
  component: ReasonDialog,
  parameters: { layout: "padded" },
  render: (args) => <DialogHost {...args} />,
  args: {
    open: true,
    onOpenChange: fn(),
    title: "Отозвать доступ к «AI Engineering: разработка с агентами»?",
    consequence: (
      <>
        Материалы продукта закроются. Группа в Telegram закроется, только если у
        человека не осталось другого продукта с этой группой. Остальные
        продукты, история, оплаты и учебные записи сохранятся.
      </>
    ),
    reasons: [
      { value: "refund", label: "Возврат оплаты" },
      { value: "rules", label: "Нарушение правил сообщества" },
      { value: "mistake", label: "Выдан по ошибке" },
      { value: "other", label: "Другое" },
    ],
    otherValue: "other",
    noteLabel: "Комментарий",
    confirmLabel: "Отозвать доступ",
    tone: "danger",
    onConfirm: confirm,
  },
  beforeEach: () => {
    confirm.mockClear();
  },
} satisfies Meta<typeof ReasonDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

async function dialogOf(title: string) {
  return within(document.body).findByRole("dialog", { name: title });
}

export const RevokeDesktop: Story = {
  ...desktop,
  play: async ({ args }) => {
    const dialog = await dialogOf(args.title);
    const view = within(dialog);
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Отмена" })).toHaveFocus(),
    );
    await userEvent.click(
      view.getByRole("button", { name: "Отозвать доступ" }),
    );
    await expect(view.getByText("Выберите причину")).toBeVisible();
    await expect(
      view.getByRole("radiogroup", { name: "Причина" }),
    ).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(view.getByRole("radio", { name: "Другое" }));
    await expect(view.queryByText("Выберите причину")).toBeNull();
    await userEvent.click(
      view.getByRole("button", { name: "Отозвать доступ" }),
    );
    await expect(view.getByText("Опишите причину")).toBeVisible();
    const note = view.getByRole("textbox", { name: "Комментарий" });
    await expect(note).toHaveFocus();
    await userEvent.type(note, "Попросил закрыть доступ до конца месяца");
    await expect(view.queryByText("Опишите причину")).toBeNull();
    await userEvent.click(
      view.getByRole("button", { name: "Отозвать доступ" }),
    );
    await expect(confirm).toHaveBeenCalledWith({
      reason: "other",
      note: "Попросил закрыть доступ до конца месяца",
    });
  },
};

export const RevokeMobile: Story = {
  ...mobile,
  play: async ({ args }) => {
    const dialog = await dialogOf(args.title);
    const box = dialog.getBoundingClientRect();
    await expect(Math.round(box.width)).toBe(window.innerWidth);
    await expect(Math.round(box.bottom)).toBe(window.innerHeight);
    for (const button of within(dialog).getAllByRole("button"))
      await expect(
        touchTarget(button).height,
        button.textContent,
      ).toBeGreaterThanOrEqual(44);
    for (const radio of within(dialog).getAllByRole("radio")) {
      const label = radio.closest("label");
      if (label === null) throw new Error("Причина без подписи");
      await expect(
        label.getBoundingClientRect().height,
        label.textContent,
      ).toBeGreaterThanOrEqual(44);
    }
  },
};

/** Сервер отказал: диалог остаётся открытым, выбор сохранён, ошибка видна над формой. */
export const FailedDesktop: Story = {
  ...desktop,
  args: {
    error:
      "Не удалось отозвать доступ: сервер не ответил. Выбор сохранён, попробуйте ещё раз.",
  },
  play: async ({ args }) => {
    const dialog = await dialogOf(args.title);
    await expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Не удалось отозвать доступ",
    );
  },
};

export const FailedMobile: Story = { ...FailedDesktop, ...mobile };

/** Действие выполняется: кнопки недоступны, Escape диалог не закрывает. */
export const PendingDesktop: Story = {
  ...desktop,
  args: { pending: true },
  play: async ({ args }) => {
    const dialog = await dialogOf(args.title);
    await expect(
      within(dialog).getByRole("button", { name: "Отозвать доступ" }),
    ).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toBeVisible();
  },
};

/** Обычное действие: без красной кнопки, фокус на первой причине, Escape закрывает. */
export const RestoreDesktop: Story = {
  ...desktop,
  args: {
    title: "Восстановить доступ к «AI Engineering: разработка с агентами»?",
    consequence: undefined,
    reasons: [
      { value: "paid", label: "Оплата подтверждена" },
      { value: "mistake", label: "Отозван по ошибке" },
      { value: "other", label: "Другое" },
    ],
    confirmLabel: "Восстановить доступ",
    tone: "default",
  },
  play: async ({ args, canvasElement }) => {
    const dialog = await dialogOf(args.title);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("radio", { name: "Оплата подтверждена" }),
      ).toHaveFocus(),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeVisible());
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Отозвать" }),
    );
    await expect(await dialogOf(args.title)).toBeVisible();
  },
};

export const RestoreMobile: Story = {
  ...RestoreDesktop,
  ...mobile,
  play: async ({ args }) => {
    await expect(await dialogOf(args.title)).toBeVisible();
  },
};
