import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, waitFor, within } from "storybook/test";

import {
  ApplicationShell,
  publicMobileNavigationItems,
  publicNavigationItems,
} from "@/widgets/application-shell";

function RetainedShell({
  withAlternative = false,
}: {
  readonly withAlternative?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <div className="min-h-[5000px]">
      <button
        type="button"
        onClick={() => {
          setVisible(false);
        }}
      >
        Скрыть оболочку
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуть оболочку
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Удалить оболочку
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <ApplicationShell
            currentPath="/"
            mobileNavigationItems={publicMobileNavigationItems}
            navigationItems={publicNavigationItems}
          >
            <div className="min-h-[3000px]">Длинное содержимое оболочки</div>
          </ApplicationShell>
        ) : null}
      </Activity>
      {withAlternative ? (
        <Activity mode={visible ? "hidden" : "visible"}>
          <ApplicationShell
            currentPath="/bookmarks"
            mobileNavigationItems={publicMobileNavigationItems}
            navigationItems={publicNavigationItems}
          >
            <div className="min-h-[3000px]">Содержимое другой оболочки</div>
          </ApplicationShell>
        </Activity>
      ) : null}
    </div>
  );
}

/** Waits for the actual native event after a document position change, including hidden content. */
async function scrollDocument(top: number) {
  if (window.scrollY === top) return;
  const scrolled = Promise.withResolvers<undefined>();
  window.addEventListener(
    "scroll",
    () => {
      scrolled.resolve(undefined);
    },
    {
      once: true,
    },
  );
  window.scrollTo({ top, behavior: "instant" });
  await scrolled.promise;
  await expect(window.scrollY).toBe(top);
}

const meta = {
  title: "Patterns/Application shell lifetime",
  component: RetainedShell,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
} satisfies Meta<typeof RetainedShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DirectionAndFocus: Story = {
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector<HTMLElement>(
      "[data-mobile-header]",
    );
    if (header === null) throw new Error("Missing public mobile header");
    try {
      await scrollDocument(0);
      await scrollDocument(600);
      await waitFor(() =>
        expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      await scrollDocument(598);
      await expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        0,
      );
      await scrollDocument(580);
      await waitFor(() =>
        expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
      );
      await scrollDocument(700);
      await waitFor(() =>
        expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      within(header)
        .getByRole("link", { name: "sachkov.dev, Главная" })
        .focus({ preventScroll: true });
      await waitFor(() =>
        expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
      );
      await expect(window.scrollY).toBe(700);
      await scrollDocument(900);
      await waitFor(() =>
        expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
      );
    } finally {
      await scrollDocument(0);
    }
  },
};

export const RetainedHeader: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector<HTMLElement>(
      "[data-mobile-header]",
    );
    if (header === null) throw new Error("Missing public mobile header");
    try {
      await scrollDocument(0);
      await scrollDocument(600);
      await waitFor(() =>
        expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      canvas.getByRole("button", { name: "Скрыть оболочку" }).click();
      await waitFor(() => expect(header).not.toBeVisible());
      await expect(header.isConnected).toBe(true);
      await scrollDocument(100);
      canvas.getByRole("button", { name: "Вернуть оболочку" }).click();
      await waitFor(() => expect(header).toBeVisible());
      await expect(canvasElement.querySelector("[data-mobile-header]")).toBe(
        header,
      );
      await waitFor(() =>
        expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      within(header)
        .getByRole("link", { name: "sachkov.dev, Главная" })
        .focus({ preventScroll: true });
      await waitFor(() =>
        expect(header.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
      );
      canvas.getByRole("button", { name: "Удалить оболочку" }).click();
      await waitFor(() => expect(header.isConnected).toBe(false));
    } finally {
      await scrollDocument(0);
    }
  },
};

export const RetainedShellOwnership: Story = {
  render: () => <RetainedShell withAlternative />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvasElement.querySelector<HTMLElement>(
      "[data-mobile-header]",
    );
    if (first === null) throw new Error("Missing initial public header");
    try {
      await scrollDocument(0);
      await scrollDocument(600);
      await waitFor(() =>
        expect(first.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      canvas.getByRole("button", { name: "Скрыть оболочку" }).click();
      await waitFor(() => expect(first).not.toBeVisible());
      await waitFor(() =>
        expect(
          canvasElement.querySelectorAll("[data-mobile-header]").length,
        ).toBe(2),
      );
      const second = canvasElement.querySelectorAll<HTMLElement>(
        "[data-mobile-header]",
      )[1];
      if (second === undefined)
        throw new Error("Missing alternative public header");
      await waitFor(() => expect(second).toBeVisible());
      await scrollDocument(800);
      await waitFor(() =>
        expect(second.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      within(second)
        .getByRole("link", { name: "sachkov.dev, Главная" })
        .focus({ preventScroll: true });
      await waitFor(() =>
        expect(second.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
      );
      canvas.getByRole("button", { name: "Вернуть оболочку" }).click();
      await waitFor(() => {
        expect(first).toBeVisible();
        expect(second).not.toBeVisible();
      });
      await waitFor(() =>
        expect(first.getBoundingClientRect().bottom).toBeLessThanOrEqual(0),
      );
      within(first)
        .getByRole("link", { name: "sachkov.dev, Главная" })
        .focus({ preventScroll: true });
      await waitFor(() =>
        expect(first.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
      );
    } finally {
      await scrollDocument(0);
    }
  },
};
