import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  guideOnlyOffer,
  materialsOffer,
  supportOffer,
} from "@/workshop/billing.fixtures";

import { OfferCard } from "./offer-card";

const meta = {
  title: "Components/Billing/Offer card",
  component: OfferCard,
  args: { snapshot: materialsOffer },
  parameters: {
    docs: {
      description: {
        component:
          "Состав и цена приходят снимком сервера. Карточка ничего не пересчитывает.",
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
      canvas.getByText("Все опубликованные материалы и руководства"),
    ).toBeInTheDocument();
  },
};
export const WithSupportAndPromotion: Story = {
  args: { snapshot: supportOffer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Старт · −20%")).toBeInTheDocument();
    await expect(canvas.getByText("бессрочно")).toBeInTheDocument();
  },
};
export const GuideOnly: Story = {
  args: { snapshot: guideOnlyOffer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Отдельное руководство")).toBeInTheDocument();
    await expect(canvas.getByText("бессрочно")).toBeInTheDocument();
  },
};
export const Current: Story = {
  args: { snapshot: supportOffer, current: true, selected: true },
};
export const Archived: Story = {
  args: {
    snapshot: {
      ...materialsOffer,
      offer: { ...materialsOffer.offer, archived: true },
    },
  },
};
export const Mobile: Story = {
  args: { snapshot: supportOffer },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  args: { snapshot: supportOffer },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
