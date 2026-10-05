import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { TariffsView } from "@/features/billing-admin";
import { tariffRows } from "@/features/billing-admin/model/access-operations";
import {
  guideOnlyOffer,
  materialsOffer,
  supportOffer,
} from "@/workshop/billing.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/workshop/story-environment";

import { AccessSection } from "./access-section.client";

const environment = authoringPageEnvironment("/authoring/access");
/** Подписка только по приглашению, продающаяся подписка для всех и руководство без продажи. */
const tariffs = tariffRows([
  {
    ...supportOffer,
    offer: { ...supportOffer.offer, eligibility: "invitation_only" },
  },
  materialsOffer,
  {
    ...materialsOffer,
    paymentOption: {
      ...materialsOffer.paymentOption,
      id: "00000000-0000-4000-8000-000000000299",
      months: 12,
      priceKopecks: 1_000_000,
    },
  },
  guideOnlyOffer,
]);

const meta = {
  ...environment,
  title: "Pages/Authoring/Access tariffs",
  component: TariffsView,
  render: (args) => (
    <AccessSection
      tabs={[
        { id: "tariffs", label: "Тарифы", panel: <TariffsView {...args} /> },
      ]}
    />
  ),
  args: {
    tariffs,
    busy: false,
    message: "",
    failure: null,
    onSaveEligibility: fn(),
    onToggleSale: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Доступ», вкладка «Тарифы»: цены Offer, кому он продаётся и тумблер продажи. " +
          "«Только по приглашению» скрывает Offer с витрины.",
      },
    },
  },
} satisfies Meta<typeof TariffsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Каждый Offer показан один раз с ценами; допуск сохраняется только после изменения. */
export const Catalog: Story = {
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("tab", { name: "Тарифы", selected: true }),
    ).toBeVisible();
    const materials = within(
      page.getByRole("listitem", { name: materialsOffer.offer.name }),
    );
    await expect(materials.getAllByRole("listitem")).toHaveLength(2);
    await expect(materials.getByText(/подписка на 12/u)).toBeVisible();
    const save = materials.getByRole("button", { name: "Сохранить допуск" });
    await expect(save).toBeDisabled();
    await userEvent.selectOptions(
      materials.getByLabelText("Кому продаётся"),
      "invitation_only",
    );
    await userEvent.click(save);
    await expect(args.onSaveEligibility).toHaveBeenCalledWith(
      tariffs[1],
      "invitation_only",
    );
    const support = within(
      page.getByRole("listitem", { name: supportOffer.offer.name }),
    );
    await expect(support.getByLabelText("Кому продаётся")).toHaveValue(
      "invitation_only",
    );
    await userEvent.click(
      support.getByRole("button", { name: "Снять с продажи" }),
    );
    await expect(args.onToggleSale).toHaveBeenCalledWith(tariffs[0], false);
    const guide = within(
      page.getByRole("listitem", { name: guideOnlyOffer.offer.name }),
    );
    await expect(guide.getByText("Не продаётся")).toBeVisible();
    await userEvent.click(
      guide.getByRole("button", { name: "Включить продажу" }),
    );
    await expect(args.onToggleSale).toHaveBeenCalledWith(tariffs[2], true);
  },
};

export const Saved: Story = {
  args: { message: "«Материалы» продаётся только по приглашению." },
};

export const SaleRefused: Story = {
  args: {
    failure:
      "Оплата не настроена: без терминала и адреса для чеков продажу не включить.",
  },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("alert"),
    ).toHaveTextContent(/Оплата не настроена/u);
  },
};

export const Empty: Story = { args: { tariffs: [] } };

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
