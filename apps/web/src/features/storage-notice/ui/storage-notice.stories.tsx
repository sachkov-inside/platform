import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { currentLegalEdition } from "@inside/legal";

import { publicPageEnvironment } from "@/storybook/story-environment";

import { storageNoticeKey } from "../model/storage-notice";

/** Уведомление ставит сама публичная оболочка; story открывает её как при первом посещении. */
const environment = publicPageEnvironment("/", {
  storageNotice: "first-visit",
});
const edition = currentLegalEdition("cookies").version;

const meta = {
  ...environment,
  title: "Patterns/Storage notice",
  render: () => <></>,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Уведомление о хранении в браузере по cookies v2: при первом посещении, без выбора, со ссылкой на документ. Его показывает публичная оболочка на любой странице. «Понятно» запоминает номер редакции; новая редакция показывает уведомление снова.",
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstVisit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const notice = await canvas.findByRole("region", {
      name: "Хранение в браузере",
    });
    await expect(
      within(notice).getByRole("link", { name: "Подробнее" }),
    ).toHaveAttribute("href", "/legal/cookies");
    await expect(
      within(notice).queryByRole("checkbox"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(notice).getByRole("button", { name: "Понятно" }),
    );
    await waitFor(() =>
      expect(
        canvas.queryByRole("region", { name: "Хранение в браузере" }),
      ).not.toBeInTheDocument(),
    );
    await expect(window.localStorage.getItem(storageNoticeKey)).toBe(
      String(edition),
    );
  },
};

export const NewEdition: Story = {
  beforeEach: () => {
    window.localStorage.setItem(storageNoticeKey, String(edition - 1));
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("region", { name: "Хранение в браузере" }),
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
