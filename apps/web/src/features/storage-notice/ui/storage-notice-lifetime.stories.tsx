import { currentLegalEdition } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { StorageNotice } from "./storage-notice.client";

// The shell's current edition is acknowledged; this public component receives a synthetic next edition.
const environment = publicPageEnvironment("/");
const edition = currentLegalEdition("cookies").version + 1;

function RetainedNotice() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
        }}
      >
        Скрыть уведомление
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуть уведомление
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Удалить уведомление
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <StorageNotice
            edition={edition}
            policyHref={legalDocumentPath("cookies")}
          />
        ) : null}
      </Activity>
    </>
  );
}

const meta = {
  ...environment,
  title: "Patterns/Storage notice lifetime",
  component: RetainedNotice,
} satisfies Meta<typeof RetainedNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReleasesSpaceWhileHidden: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const notice = await canvas.findByRole("region", {
      name: "Хранение в браузере",
    });
    const reserved = () =>
      document.documentElement.style.getPropertyValue("--storage-notice-space");
    await waitFor(() =>
      expect(reserved()).toBe(`${String(notice.offsetHeight)}px`),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть уведомление" }),
    );
    await waitFor(() => expect(notice).not.toBeVisible());
    await expect(notice.isConnected).toBe(true);
    await waitFor(() => expect(reserved()).toBe(""));
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть уведомление" }),
    );
    await waitFor(() => expect(notice).toBeVisible());
    await expect(
      canvas.getByRole("region", { name: "Хранение в браузере" }),
    ).toBe(notice);
    await waitFor(() =>
      expect(reserved()).toBe(`${String(notice.offsetHeight)}px`),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить уведомление" }),
    );
    await waitFor(() => expect(notice.isConnected).toBe(false));
    await waitFor(() => expect(reserved()).toBe(""));
  },
};
