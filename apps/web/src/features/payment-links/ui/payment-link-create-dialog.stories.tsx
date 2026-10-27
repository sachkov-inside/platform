import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { productPriceChoices } from "@/entities/subscription";
import { desktop, mobile } from "@/storybook/loads-in-place";
import { withMutationFetch } from "@/storybook/mutation-mock";
import {
  salesCatalogFetch,
  storyCatalog,
  storyProducts,
} from "@/storybook/sales-catalog.fixtures";

import { PaymentLinkCreateDialog } from "./payment-link-create-dialog.client";

const choices = productPriceChoices(storyCatalog);
const aiEngineering = storyProducts[0]?.id ?? "";

const meta = {
  title: "Components/Админка/Продажи/Создание ссылки на оплату",
  component: PaymentLinkCreateDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    onCreated: fn(),
    products: { kind: "ready", choices },
  },
  decorators: [withMutationFetch(salesCatalogFetch({}))],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Создание ссылки на оплату: на телефоне лист снизу, на компьютере диалог. Цена как у продукта, итоговой суммой или скидкой в процентах; срок по московскому дню включительно; после создания копирование и отправка ссылки.",
      },
    },
  },
} satisfies Meta<typeof PaymentLinkCreateDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const dialogOf = () =>
  within(document.body).findByRole("dialog", {
    name: "Новая ссылка на оплату",
  });

async function chooseProduct() {
  const dialog = await dialogOf();
  await userEvent.type(
    within(dialog).getByRole("searchbox", { name: "Поиск: Продукт" }),
    "AI",
  );
  await userEvent.selectOptions(
    within(dialog).getByRole("combobox", { name: "Продукт" }),
    aiEngineering,
  );
  return dialog;
}

export const ProductPriceMobile: Story = {
  globals: mobile.globals,
  name: "Цена как у продукта · телефон",
  play: async () => {
    const dialog = await chooseProduct();
    const preview = within(dialog).getByRole("region", {
      name: "Итог по ссылке",
    });
    await expect(preview).toHaveTextContent(/29\s900\s₽/u);
    await expect(preview).toHaveTextContent("Без срока: до оплаты или отзыва");
  },
};

export const ProductPriceDesktop: Story = {
  ...ProductPriceMobile,
  globals: desktop.globals,
  name: "Цена как у продукта · широкий экран",
};

export const AmountMobile: Story = {
  globals: mobile.globals,
  name: "Итоговая сумма · телефон",
  play: async () => {
    const dialog = await chooseProduct();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Сумма, ₽" }),
    );
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Сумма к оплате, ₽" }),
      "19 990",
    );
    await expect(
      within(dialog).getByRole("region", { name: "Итог по ссылке" }),
    ).toHaveTextContent(/19\s990\s₽/u);
  },
};

export const AmountDesktop: Story = {
  ...AmountMobile,
  globals: desktop.globals,
  name: "Итоговая сумма · широкий экран",
};

export const DiscountMobile: Story = {
  globals: mobile.globals,
  name: "Скидка в процентах · телефон",
  play: async () => {
    const dialog = await chooseProduct();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Скидка, %" }),
    );
    const percent = within(dialog).getByRole("textbox", { name: "Скидка, %" });
    await userEvent.clear(percent);
    await userEvent.type(percent, "15");
    await expect(
      within(dialog).getByRole("region", { name: "Итог по ссылке" }),
    ).toHaveTextContent(/25\s415\s₽/u);
  },
};

export const DiscountDesktop: Story = {
  ...DiscountMobile,
  globals: desktop.globals,
  name: "Скидка в процентах · широкий экран",
};

export const CreatedMobile: Story = {
  globals: mobile.globals,
  name: "Ссылка создана · телефон",
  play: async () => {
    const dialog = await chooseProduct();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Создать ссылку" }),
    );
    const created = await within(document.body).findByRole("dialog", {
      name: "Ссылка создана",
    });
    const address = within(created).getByRole("textbox", {
      name: "Ссылка для покупателя",
    });
    await expect(
      address instanceof HTMLInputElement ? address.value : "",
    ).toMatch(/\/payment\/links\/98100000-0000-4000-8000-000000000901$/u);
    await expect(
      within(created).getByRole("button", { name: "Скопировать ссылку" }),
    ).toBeVisible();
  },
};

export const CreatedDesktop: Story = {
  ...CreatedMobile,
  globals: desktop.globals,
  name: "Ссылка создана · широкий экран",
};

/** Вкладка «Продажа» продукта: продукт задан, выбора нет. */
export const FixedProductDesktop: Story = {
  args: { fixedProductId: aiEngineering },
  globals: desktop.globals,
  name: "Продукт задан страницей продукта",
  play: async () => {
    const dialog = await dialogOf();
    await expect(
      within(dialog).queryByRole("combobox", { name: "Продукт" }),
    ).not.toBeInTheDocument();
    await expect(dialog).toHaveTextContent("AI Engineering");
  },
};

export const ProductsUnavailable: Story = {
  args: { products: { kind: "unavailable", onRetry: fn() } },
  globals: mobile.globals,
  name: "Каталог цен недоступен",
  play: async () => {
    const dialog = await dialogOf();
    await expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Не удалось загрузить продукты и цены",
    );
  },
};
