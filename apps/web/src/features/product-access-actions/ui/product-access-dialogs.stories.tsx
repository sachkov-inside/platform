import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { storyProducts } from "@/storybook/people.fixtures";

import {
  GrantProductDialog,
  type GrantProductDialogProps,
} from "./grant-product-dialog.client";
import { RestoreAccessDialog } from "./restore-access-dialog.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const confirmed = fn();
const restoreInstead = fn();
const held = new Map<string, "active" | "revoked">([
  [storyProducts[0].productId, "active"],
  [storyProducts[1].productId, "revoked"],
]);

const meta = {
  args: {
    catalog: { kind: "ready", products: storyProducts },
    error: null,
    held,
    onConfirm: confirmed,
    onOpenChange: fn(),
    onRestoreInstead: restoreInstead,
    open: true,
    pending: false,
    personTitle: "Константин Константинопольский-Задунайский",
  },
  beforeEach: () => {
    confirmed.mockClear();
    restoreInstead.mockClear();
  },
  component: GrantProductDialog,
  // Продукты человека по карточке: Map не переживает сериализацию аргументов Storybook.
  render: (args) => <GrantProductDialog {...args} held={held} />,
  parameters: {
    docs: {
      description: {
        component:
          "Окна действий с доступом из карточки человека (#1721): «Выдать продукт» с каталогом и причиной и короткое «Восстановить». Отзыв идёт через общий `ReasonDialog` с последствием из предпросмотра. Окна ничего не решают сами: подсказки берут состояние из карточки, итог отвечает Product Access.",
      },
    },
    layout: "padded",
  },
  title: "Components/Админка/Действия с доступом",
} satisfies Meta<typeof GrantProductDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = (name: string) =>
  within(document.body).findByRole("dialog", { name });

export const Grant: Story = {
  ...desktop,
  name: "Выдать продукт",
  play: async () => {
    const grant = within(await dialog("Выдать продукт"));
    await expect(
      grant.getByText("Константин Константинопольский-Задунайский"),
    ).toBeVisible();
    await expect(
      grant.getByRole("radio", { name: `${storyProducts[3].name} (в архиве)` }),
    ).toBeVisible();
    await userEvent.click(
      grant.getByRole("radio", { name: storyProducts[2].name }),
    );
    await userEvent.click(grant.getByRole("radio", { name: "Другое" }));
    await userEvent.click(
      grant.getByRole("button", { name: "Выдать продукт" }),
    );
    await expect(grant.getByText("Опишите причину")).toBeVisible();
    await userEvent.type(
      grant.getByLabelText("Заметка"),
      "  партнёрская\n программа ",
    );
    await userEvent.click(
      grant.getByRole("button", { name: "Выдать продукт" }),
    );
    await expect(confirmed).toHaveBeenCalledWith({
      product: storyProducts[2],
      reason: "Другое: партнёрская программа",
    });
  },
};

export const GrantMobile: Story = {
  ...mobile,
  name: "Выдать продукт · телефон",
  play: async ({ canvasElement }) => {
    await dialog("Выдать продукт");
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBe(root.clientWidth);
  },
};

export const GrantActive: Story = {
  ...desktop,
  name: "Продукт уже выдан · ничего не изменится",
  play: async () => {
    const grant = within(await dialog("Выдать продукт"));
    await userEvent.click(
      grant.getByRole("radio", {
        name: `${storyProducts[0].name} · уже выдан`,
      }),
    );
    await expect(
      grant.getByText(
        `У человека уже есть доступ к «${storyProducts[0].name}». Выдача ничего не изменит.`,
      ),
    ).toBeVisible();
  },
};

export const GrantRevoked: Story = {
  ...desktop,
  name: "Продукт отозван · к восстановлению",
  play: async () => {
    const grant = within(await dialog("Выдать продукт"));
    await userEvent.click(
      grant.getByRole("radio", { name: `${storyProducts[1].name} · отозван` }),
    );
    await expect(grant.queryByRole("radio", { name: "Подарок" })).toBeNull();
    await userEvent.click(
      grant.getByRole("button", { name: "Перейти к восстановлению" }),
    );
    await expect(restoreInstead).toHaveBeenCalledWith(
      storyProducts[1].productId,
    );
  },
};

export const GrantFailed: Story = {
  ...desktop,
  args: {
    error:
      "Доступ сейчас не изменить: сервис не ответил. Ничего не изменилось, повторите позже.",
  } satisfies Partial<GrantProductDialogProps>,
  name: "Выдача не удалась",
  play: async () => {
    const grant = within(await dialog("Выдать продукт"));
    await expect(grant.getByRole("alert")).toHaveTextContent(
      "Ничего не изменилось",
    );
  },
};

export const GrantPending: Story = {
  ...desktop,
  args: { pending: true },
  name: "Выдача выполняется",
  play: async () => {
    const grant = within(await dialog("Выдать продукт"));
    await expect(
      grant.getByRole("button", { name: "Выдать продукт" }),
    ).toBeDisabled();
  },
};

export const Restore: Story = {
  ...desktop,
  name: "Восстановить",
  play: async () => {
    const restore = within(
      await dialog(`Восстановить доступ к «${storyProducts[1].name}»`),
    );
    await userEvent.type(restore.getByLabelText("Причина"), "Оплата нашлась");
    await userEvent.click(
      restore.getByRole("button", { name: "Восстановить доступ" }),
    );
    await expect(confirmed).toHaveBeenCalledWith("Оплата нашлась");
  },
  render: () => (
    <RestoreAccessDialog
      error={null}
      onConfirm={confirmed}
      onOpenChange={fn()}
      open
      pending={false}
      productName={storyProducts[1].name}
    />
  ),
};

export const RestoreMobile: Story = {
  ...Restore,
  ...mobile,
  name: "Восстановить · телефон",
  play: async ({ canvasElement }) => {
    await dialog(`Восстановить доступ к «${storyProducts[1].name}»`);
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBe(root.clientWidth);
  },
};
