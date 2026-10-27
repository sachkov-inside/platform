import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { AmountField, type AmountFieldProps } from "./amount-field.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const changed = fn();

/** `Intl` разделяет разряды неразрывным пробелом; сравнение идёт по любому пробелу. */
function inputValue(element: HTMLElement): string {
  if (!(element instanceof HTMLInputElement)) throw new Error("Не поле ввода");
  return element.value;
}

/** Форма держит копейки; поле только показывает и читает их. */
function PriceForm(props: AmountFieldProps) {
  const [kopecks, setKopecks] = useState(props.valueKopecks);
  return (
    <div className="grid max-w-md gap-6">
      <AmountField
        {...props}
        onChange={(next) => {
          changed(next);
          setKopecks(next);
        }}
        valueKopecks={kopecks}
      />
      <button className="admin-text-button justify-self-start" type="button">
        Далее
      </button>
    </div>
  );
}

const meta = {
  title: "Components/Админка/AmountField",
  component: AmountField,
  parameters: { layout: "padded" },
  render: (args) => <PriceForm {...args} />,
  args: {
    label: "Цена",
    name: "priceKopecks",
    valueKopecks: 499_000,
    onChange: fn(),
    min: 100,
    max: 50_000_000,
    hint: "Сумма, которую покупатель увидит на странице продукта.",
  },
  beforeEach: () => {
    changed.mockClear();
  },
} satisfies Meta<typeof AmountField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PriceDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Цена, ₽" });
    await expect(input).toHaveAttribute("inputmode", "decimal");
    await expect(inputValue(input)).toMatch(/^4\s990$/u);
    await expect(input).toHaveAccessibleDescription(
      "Сумма, которую покупатель увидит на странице продукта.",
    );

    await userEvent.clear(input);
    await userEvent.type(input, "1234,5 ₽");
    await expect(changed).toHaveBeenLastCalledWith(123_450);
    // Пока человек в поле, ошибок нет и текст не переписывается.
    await expect(input).toHaveValue("1234,5 ₽");
    await userEvent.tab();
    await expect(inputValue(input)).toMatch(/^1\s234,50$/u);
    await expect(input).toHaveAttribute("aria-invalid", "false");

    await userEvent.clear(input);
    await userEvent.type(input, "двадцать");
    await expect(canvas.queryByText(/Введите сумму числом/u)).toBeNull();
    await userEvent.tab();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      /Введите сумму числом, например 4 990 или 1 234,50/u,
    );
    await expect(input).toHaveValue("двадцать");

    await userEvent.clear(input);
    await userEvent.type(input, "0,5");
    await userEvent.tab();
    await expect(
      canvas.getByText("Сумма не может быть меньше 1 ₽"),
    ).toBeVisible();
  },
};

export const PriceMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", {
      name: "Цена, ₽",
    });
    await expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      44,
    );
  },
};

export const ServerErrorDesktop: Story = {
  ...desktop,
  args: {
    label: "Сумма скидки",
    valueKopecks: 600_000,
    hint: "",
    error: "Сумма скидки не может превышать цену продукта 4 990 ₽",
  },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", {
      name: "Сумма скидки, ₽",
    });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      "Сумма скидки не может превышать цену продукта 4 990 ₽",
    );
  },
};

export const EmptyRequiredMobile: Story = {
  ...mobile,
  args: { valueKopecks: null, required: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("textbox", { name: "Цена, ₽" }));
    await userEvent.tab();
    await expect(canvas.getByText("Введите сумму")).toBeVisible();
  },
};
