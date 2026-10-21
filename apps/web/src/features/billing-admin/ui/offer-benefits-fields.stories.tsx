import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { productCapability } from "@/entities/subscription";
import { OfferBenefitsFields } from "./offer-benefits-fields.client";

const productId = "97000000-0000-4000-8000-000000000003";
const capability = productCapability(productId);
const meta = {
  title: "Features/Access/Offer composition",
  component: OfferBenefitsFields,
  args: {
    benefits: ["support", capability],
    periods: [
      { capability: "support", months: 6 },
      { capability, months: null },
    ],
    products: [{ id: productId, title: "Инженерная практика" }],
  },
  render: (args) => (
    <form>
      <OfferBenefitsFields {...args} />
    </form>
  ),
  parameters: { layout: "padded" },
} satisfies Meta<typeof OfferBenefitsFields>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TermsAndSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const form = canvasElement.querySelector("form");
    if (form === null) throw new Error("Offer form is missing");
    const serialized = () => new FormData(form).get("offerBenefits");
    await expect(serialized()).toBe(`support=6\n${capability}=null`);
    await userEvent.type(canvas.getByRole("searchbox"), "Нет такого продукта");
    await expect(
      canvas.getByRole("checkbox", { name: "Инженерная практика" }),
    ).toBeChecked();
    await expect(serialized()).toBe(`support=6\n${capability}=null`);
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Сообщество продукта" }),
    );
    await userEvent.selectOptions(
      canvas.getByLabelText("Срок: Сообщество продукта"),
      "months",
    );
    await userEvent.clear(
      canvas.getByLabelText("Месяцев: Сообщество продукта"),
    );
    await userEvent.type(
      canvas.getByLabelText("Месяцев: Сообщество продукта"),
      "12",
    );
    await expect(serialized()).toBe(
      `support=6\n${capability}=null\ncommunity=12`,
    );
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Вопросы автору и эфиры" }),
    );
    await expect(serialized()).toBe(`${capability}=null\ncommunity=12`);
    await userEvent.selectOptions(
      canvas.getByLabelText("Срок: Инженерная практика"),
      "default",
    );
    await expect(serialized()).toBe(`${capability}\ncommunity=12`);
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const SameNameProducts: Story = {
  args: {
    benefits: [],
    periods: [],
    products: Array.from({ length: 23 }, (_, index) => ({
      id: `97000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: "Одинаковый продукт",
    })),
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await userEvent.click(
      page.getByRole("button", { name: "Следующие продукты" }),
    );
    const last = page
      .getAllByRole("checkbox", { name: "Одинаковый продукт" })
      .at(2);
    if (last === undefined) throw new Error("Third product is missing");
    await userEvent.click(last);
    await userEvent.click(
      page.getByRole("button", { name: "Предыдущие продукты" }),
    );
    await expect(page.getAllByRole("checkbox").length).toBeLessThanOrEqual(25);
    const form = canvasElement.querySelector("form");
    if (form === null) throw new Error("Missing offer form");
    await expect(new FormData(form).get("offerBenefits")).toBe(
      productCapability("97000000-0000-4000-8000-000000000022"),
    );
    await expect(
      page
        .getAllByRole("checkbox", { name: "Одинаковый продукт" })
        .filter((input) => input instanceof HTMLInputElement && input.checked),
    ).toHaveLength(1);
  },
};
