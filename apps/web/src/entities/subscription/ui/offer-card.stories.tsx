import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { materialsOffer, supportOffer } from "@/storybook/billing.fixtures";

import { OfferCard } from "./offer-card";

const meta = {
  title: "Components/Billing/Offer card",
  component: OfferCard,
  args: { snapshot: materialsOffer },
  parameters: {
    docs: {
      description: {
        component:
          "Карточка тарифа на витрине подписки. Состав и цена приходят снимком сервера; карточка ничего не пересчитывает. Витрина показывает только продаваемые варианты подписки (`publicSubscriptionOffers`), поэтому разовых и архивных карточек нет.",
      },
    },
  },
} satisfies Meta<typeof OfferCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Materials: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/1\s?000\s?₽/u)).toBeInTheDocument();
    await expect(
      canvas.getByText("Все опубликованные материалы и продукты"),
    ).toBeInTheDocument();
  },
};
export const WithSupportAndPromotion: Story = {
  args: { snapshot: supportOffer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Старт · −20%")).toBeInTheDocument();
    // Право без даты окончания не называет срок: кабинет и сводки прав такой срок не показывают.
    await expect(
      canvas.queryByText("без даты окончания"),
    ).not.toBeInTheDocument();
  },
};
export const Current: Story = {
  args: { snapshot: supportOffer, current: true, selected: true },
};
export const Mobile: Story = {
  args: { snapshot: supportOffer },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  args: { snapshot: supportOffer },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
