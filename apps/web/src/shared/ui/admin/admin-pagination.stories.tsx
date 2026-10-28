import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { internalRoute } from "@/shared/routing/internal-route";

import {
  AdminCursorPagination,
  AdminPagination,
} from "./admin-pagination.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const meta = {
  title: "Components/Админка/AdminPagination",
  component: AdminPagination,
  parameters: { layout: "padded" },
  args: {
    label: "Страницы материалов",
    page: 2,
    totalPages: 6,
    summary: "21–40 из 112",
    hrefFor: (page) =>
      internalRoute(`/authoring/materials?page=${String(page)}`),
  },
} satisfies Meta<typeof AdminPagination>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LinksDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole("navigation", {
      name: "Страницы материалов",
    });
    const view = within(nav);
    await expect(
      view.getByRole("link", { name: "Предыдущая страница" }),
    ).toHaveAttribute("href", "/authoring/materials?page=1");
    await expect(
      view.getByRole("link", { name: "Следующая страница" }),
    ).toHaveAttribute("href", "/authoring/materials?page=3");
    await expect(view.getByText("Страница 2 из 6")).toBeVisible();
    await expect(view.getByText("21–40 из 112")).toBeVisible();
  },
};

export const LinksMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole("navigation", {
      name: "Страницы материалов",
    });
    for (const link of within(nav).getAllByRole("link")) {
      const box = link.getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(44);
      await expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    );
  },
};

/** Список браузера: страница меняется кнопками, на краях шаг недоступен. */
function BrowserPages() {
  const [page, setPage] = useState(1);
  return (
    <AdminPagination
      label="Страницы сдач"
      onPage={setPage}
      page={page}
      summary={page === 1 ? "1–20 из 23" : "21–23 из 23"}
      totalPages={2}
    />
  );
}

export const ButtonsDesktop: Story = {
  ...desktop,
  render: () => <BrowserPages />,
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole("navigation"));
    await expect(
      nav.getByRole("button", { name: "Предыдущая страница" }),
    ).toBeDisabled();
    await userEvent.click(
      nav.getByRole("button", { name: "Следующая страница" }),
    );
    await expect(nav.getByText("Страница 2 из 2")).toBeVisible();
    await expect(
      nav.getByRole("button", { name: "Следующая страница" }),
    ).toBeDisabled();
  },
};

export const ButtonsMobile: Story = { ...ButtonsDesktop, ...mobile };

/** Одна страница: номеров нет, остаётся только число записей. */
export const SinglePageDesktop: Story = {
  ...desktop,
  args: { page: 1, totalPages: 1, summary: "12 из 12" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("navigation")).toBeNull();
    await expect(canvas.getByText("12 из 12")).toBeVisible();
  },
};

export const CursorDesktop: Story = {
  ...desktop,
  render: () => (
    <AdminCursorPagination
      label="Страницы журнала оплат"
      newerHref={internalRoute("/authoring/sales/payments?before=cursor-1")}
      olderHref={internalRoute("/authoring/sales/payments?after=cursor-2")}
    />
  ),
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole("navigation"));
    await expect(nav.getByRole("link", { name: "К новым" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Более ранние" })).toBeVisible();
  },
};

export const CursorFirstPageMobile: Story = {
  ...mobile,
  render: () => (
    <AdminCursorPagination
      label="Страницы журнала оплат"
      newerHref={null}
      olderHref={internalRoute("/authoring/sales/payments?after=cursor-2")}
    />
  ),
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole("navigation"));
    await expect(nav.getByRole("button", { name: "К новым" })).toBeDisabled();
  },
};
