import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { productPriceChoices } from "@/entities/subscription";
import { desktop, mobile } from "@/storybook/loads-in-place";
import { withMutationFetch } from "@/storybook/mutation-mock";
import {
  salesCatalogFetch,
  storyCatalog,
  storyPromotions,
} from "@/storybook/sales-catalog.fixtures";

import {
  emptyPromotionForm,
  promotionFormFromItem,
} from "../model/promotion-form";
import {
  PromotionFormDialog,
  type PromotionDraft,
} from "./promotion-form-dialog.client";

const choices = productPriceChoices(storyCatalog);
const edited = storyPromotions[0];
if (edited === undefined) throw new Error("Missing story promotion");

const createDraft: PromotionDraft = {
  id: "98200000-0000-4000-8000-000000000099",
  initial: emptyPromotionForm(),
};
const editDraft: PromotionDraft = {
  id: edited.id,
  initial: promotionFormFromItem(edited),
  origin: {
    id: edited.id,
    revision: edited.revision,
    startsAt: edited.startsAt,
    endsAt: edited.endsAt,
  },
};

const meta = {
  title: "Components/Админка/Продажи/Форма скидки",
  component: PromotionFormDialog,
  args: {
    draft: createDraft,
    products: choices,
    onClose: fn(),
    onSaved: fn(),
    onRefresh: fn(),
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Создание и изменение Promotion: продукты выбираются поиском из каталога цен (пустой выбор значит «все продукты»), период задаётся днями по Москве включительно, изменение отправляет редакцию из списка.",
      },
    },
  },
} satisfies Meta<typeof PromotionFormDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const dialogNamed = (name: string) =>
  within(document.body).findByRole("dialog", { name });

export const CreateMobile: Story = {
  globals: mobile.globals,
  name: "Новая скидка · телефон",
  play: async () => {
    const dialog = await dialogNamed("Новая скидка");
    await expect(dialog).toHaveTextContent(
      "Ничего не выбрано: скидка действует на все продукты.",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Создать скидку" }),
    );
    await expect(dialog).toHaveTextContent("Введите название скидки");
    await expect(dialog).toHaveTextContent("Укажите первый день скидки");
  },
};

export const CreateDesktop: Story = {
  ...CreateMobile,
  globals: desktop.globals,
  name: "Новая скидка · широкий экран",
};

export const EditDesktop: Story = {
  args: { draft: editDraft },
  globals: desktop.globals,
  name: "Изменение · продукты выбраны",
  play: async () => {
    const dialog = await dialogNamed("Изменить скидку");
    const selected = within(dialog).getByRole("list", {
      name: "Выбрано: Продукты",
    });
    await expect(within(selected).getAllByRole("listitem")).toHaveLength(3);
    await expect(
      within(dialog).getByRole("textbox", { name: "Скидка, %" }),
    ).toHaveValue("20");
  },
};

export const EditMobile: Story = {
  ...EditDesktop,
  globals: mobile.globals,
  name: "Изменение · телефон",
};

export const RevisionConflict: Story = {
  args: { draft: editDraft },
  decorators: [
    withMutationFetch(salesCatalogFetch({ saveCode: "revision_conflict" })),
  ],
  globals: desktop.globals,
  name: "Конфликт редакции · «Обновить данные»",
  play: async () => {
    const dialog = await dialogNamed("Изменить скидку");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Сохранить изменения" }),
    );
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Скидку изменили в другом месте",
    );
    await expect(
      within(dialog).getByRole("button", { name: "Обновить данные" }),
    ).toBeVisible();
  },
};
