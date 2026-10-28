import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "@/shared/ui/button";

import { touchTarget } from "./admin.fixtures";
import { AdminListHeader } from "./admin-list-header";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const meta = {
  title: "Components/Админка/AdminListHeader",
  component: AdminListHeader,
  parameters: { layout: "padded" },
  args: {
    title: "Материалы",
    count: "112 материалов",
    action: (
      <Button className="min-h-11 px-4" type="button">
        <Plus aria-hidden="true" />
        Создать материал
      </Button>
    ),
  },
} satisfies Meta<typeof AdminListHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MaterialsDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", { level: 1 });
    await expect(heading).toHaveAccessibleName("Материалы");
    const count = canvas.getByText("112 материалов");
    const button = canvas.getByRole("button", { name: "Создать материал" });
    await expect(
      Math.abs(
        heading.getBoundingClientRect().top -
          button.getBoundingClientRect().top,
      ),
    ).toBeLessThan(16);
    await expect(count.getBoundingClientRect().left).toBeGreaterThan(
      heading.getBoundingClientRect().right,
    );
  },
};

/** На телефоне кнопка переносится под заголовок, а не сжимает его. */
export const MaterialsMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", { level: 1 });
    const button = canvas.getByRole("button", { name: "Создать материал" });
    await expect(button.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      heading.getBoundingClientRect().bottom,
    );
    await expect(touchTarget(button).height).toBeGreaterThanOrEqual(44);
  },
};

/** Длинное название переносится и не выталкивает кнопку за край телефона. */
export const LongTitleMobile: Story = {
  ...mobile,
  args: {
    title: "Ссылки на оплату для участников прежнего курса",
    count: "1 ссылка",
  },
  play: async () => {
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    );
  },
};

export const WithoutActionDesktop: Story = {
  ...desktop,
  args: { title: "Сдачи", count: "3 без комментария", action: undefined },
};
