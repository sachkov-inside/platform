import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import {
  publicPageEnvironment,
  routeContent,
} from "@/workshop/story-environment";

import { PageNotFound, PageUnexpectedError } from "./route-states";

const environment = publicPageEnvironment("/does-not-exist");

const meta = {
  ...environment,
  component: PageUnexpectedError,
  title: "Pages/Mobile-first Platform/Route states",
  args: { onRetry: fn() },
} satisfies Meta<typeof PageUnexpectedError>;

export default meta;
type Story = StoryObj<typeof meta>;

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

async function expectNotFound(canvasElement: HTMLElement) {
  const page = routeContent(canvasElement);
  await expect(
    page.getByRole("heading", { level: 1, name: "Страница не найдена" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "На главную" })).toHaveAttribute(
    "href",
    "/",
  );
}

export const NotFoundDesktop: Story = {
  globals: desktop,
  name: "Not found · desktop",
  render: () => <PageNotFound />,
  play: async ({ canvasElement }) => {
    await expectNotFound(canvasElement);
  },
};

export const NotFoundMobile: Story = {
  globals: mobile,
  name: "Not found · mobile",
  render: () => <PageNotFound />,
  play: async ({ canvasElement }) => {
    await expectNotFound(canvasElement);
  },
};

export const UnexpectedErrorDesktop: Story = {
  globals: desktop,
  name: "Unexpected error · desktop",
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Страница сейчас недоступна",
      }),
    ).toBeVisible();
    page.getByRole("button", { name: "Повторить" }).click();
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const UnexpectedErrorMobile: Story = {
  globals: mobile,
  name: "Unexpected error · mobile",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("link", { name: "На главную" })).toBeVisible();
  },
};
