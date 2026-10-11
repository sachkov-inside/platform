import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { materialsOffer } from "@/storybook/billing.fixtures";
import { authoringPageEnvironment } from "@/storybook/story-environment";

import { SubscriptionSaleConfirmationProof } from "./subscription-sale-confirmation-proof.client";

const environment = authoringPageEnvironment("/authoring/access");
const meta = {
  ...environment,
  title: "Proofs/Authoring/Subscription Sale Confirmation",
  component: SubscriptionSaleConfirmationProof,
  args: {
    tariff: {
      offer: {
        ...materialsOffer.offer,
        eligibility: "everyone",
        published: false,
      },
      options: [materialsOffer.paymentOption],
    },
    onCancel: fn(),
    onConfirm: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Отдельный UI proof #781 для решения владельца. Один native dialog на фоне настоящих " +
          "TariffsView и авторской оболочки. Callback только демонстрационные: каталог, допуск " +
          "и продажи не меняются. Production-подключения нет.",
      },
    },
  },
} satisfies Meta<typeof SubscriptionSaleConfirmationProof>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openConfirmation(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const trigger = canvas.getByRole("button", { name: "Включить продажу" });
  await userEvent.click(trigger);
  const dialog = await canvas.findByRole("dialog", {
    name: "Включить продажу подписки всем?",
  });
  await expect(
    within(dialog).getByRole("button", { name: "Отмена" }),
  ).toHaveFocus();
  return { canvas, dialog, trigger };
}

/** Диалог открыт обычной кнопкой тарифа; состояние пригодно для снимка и решения владельца. */
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement, args }) => {
    await openConfirmation(canvasElement);
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const Mobile: Story = {
  ...Desktop,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const NarrowMobile: Story = {
  ...Desktop,
  globals: { viewport: { isRotated: false, value: "mobile320" } },
};

/** Проверка UI callback. Настоящие клавиши Escape/Tab проверяются отдельным browser evidence. */
export const Interaction: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement, args }) => {
    const { canvas, dialog, trigger } = await openConfirmation(canvasElement);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отмена" }),
    );
    await waitFor(() => {
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onConfirm).not.toHaveBeenCalled();

    const reopened = await openConfirmation(canvasElement);
    // Публичное событие native dialog; это не доказательство доверенного нажатия Escape.
    reopened.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => {
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    await expect(args.onCancel).toHaveBeenCalledTimes(2);
    await expect(args.onConfirm).not.toHaveBeenCalled();

    const confirmed = await openConfirmation(canvasElement);
    await userEvent.dblClick(
      within(confirmed.dialog).getByRole("button", {
        name: "Включить продажу всем",
      }),
    );
    await waitFor(() => {
      expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    await expect(args.onConfirm).toHaveBeenCalledExactlyOnceWith(args.tariff);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Подтверждение принято в прототипе. Продажа не включена.",
    );
    await expect(
      canvas.getByText("Не продаётся", { exact: true }),
    ).toBeVisible();
  },
};
