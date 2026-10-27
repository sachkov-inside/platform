import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { DateField, type DateFieldProps } from "./date-field.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const changed = fn();

function ValidUntil(props: DateFieldProps) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="grid max-w-md gap-6">
      <DateField
        {...props}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
        value={value}
      />
      <button className="admin-text-button justify-self-start" type="button">
        Далее
      </button>
    </div>
  );
}

const meta = {
  title: "Components/Админка/DateField",
  component: DateField,
  parameters: { layout: "padded" },
  render: (args) => <ValidUntil {...args} />,
  args: {
    label: "Действует до",
    value: "2026-11-30",
    onChange: fn(),
    min: "2026-10-24",
    max: "2027-10-24",
  },
  beforeEach: () => {
    changed.mockClear();
  },
} satisfies Meta<typeof DateField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ValidUntilDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Действует до");
    await expect(input).toHaveAttribute("type", "date");
    await expect(input).toHaveValue("2026-11-30");
    await expect(input).toHaveAccessibleDescription("ДД.ММ.ГГГГ");
    await expect(canvas.getByText("ДД.ММ.ГГГГ")).toBeVisible();
  },
};

export const ValidUntilMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Действует до");
    await expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      44,
    );
  },
};

/** Дата раньше нижней границы: ошибка после ухода из поля, с понятной датой. */
export const BeforeMinimumDesktop: Story = {
  ...desktop,
  args: { value: "2026-10-01" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Действует до");
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await userEvent.click(input);
    await userEvent.tab();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(
      canvas.getByText("Дата не может быть раньше 24 окт. 2026"),
    ).toBeVisible();
  },
};

export const ServerErrorMobile: Story = {
  ...mobile,
  args: {
    label: "Начало скидки",
    value: "",
    hint: "ДД.ММ.ГГГГ, по московскому времени",
    error: "Укажите дату начала скидки",
  },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Начало скидки");
    await expect(input).toHaveAccessibleDescription(
      "ДД.ММ.ГГГГ, по московскому времени Укажите дату начала скидки",
    );
  },
};
