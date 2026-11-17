import { currentLegalEdition } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { expect, waitFor, within } from "storybook/test";

import {
  legalDocumentPath,
  legalEditionPath,
} from "@/shared/routing/public-page-path";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { WelcomeView } from "./welcome-view";

const terms = currentLegalEdition("terms");
const environment = publicPageEnvironment("/welcome", {
  account: "authenticated",
});

function RetainedWelcome() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [closeEvents, setCloseEvents] = useState(0);
  const observeClose = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    const record = (event: Event) => {
      if (event.target instanceof HTMLDialogElement)
        setCloseEvents((count) => count + 1);
    };
    element.addEventListener("close", record, true);
    return () => {
      element.removeEventListener("close", record, true);
    };
  }, []);
  return (
    <div ref={observeClose}>
      <button
        id="hide-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setVisible(false);
          });
        }}
      >
        Скрыть приветствие
      </button>
      <button
        id="show-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setVisible(true);
          });
        }}
      >
        Вернуть приветствие
      </button>
      <button
        id="unmount-welcome"
        type="button"
        onClick={() => {
          flushSync(() => {
            setMounted(false);
          });
        }}
      >
        Удалить приветствие
      </button>
      <output aria-label="Native close events">{closeEvents}</output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <WelcomeView
            privacyHref={legalDocumentPath("privacy")}
            returning={false}
            termsHref={legalEditionPath("terms", terms.version)}
          />
        ) : null}
      </Activity>
    </div>
  );
}

const meta = {
  ...environment,
  title: "Patterns/Welcome dialog lifetime",
  component: RetainedWelcome,
} satisfies Meta<typeof RetainedWelcome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReleasesHiddenModal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole<HTMLDialogElement>("dialog", {
      name: "Добро пожаловать",
    });
    const closes = canvas.getByLabelText("Native close events");
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await waitFor(() => expect(closes).toHaveTextContent("1"));
    const hide =
      canvasElement.querySelector<HTMLButtonElement>("#hide-welcome");
    const show =
      canvasElement.querySelector<HTMLButtonElement>("#show-welcome");
    const unmount =
      canvasElement.querySelector<HTMLButtonElement>("#unmount-welcome");
    if (hide === null || show === null || unmount === null)
      throw new Error("Missing fixture lifetime controls");
    hide.click();
    await expect(dialog).not.toBeVisible();
    await expect(dialog.isConnected).toBe(true);
    await expect(dialog.matches(":modal")).toBe(false);
    await expect(dialog.open).toBe(false);
    await waitFor(() => expect(closes).toHaveTextContent("2"));
    await expect(dialog.matches(":modal")).toBe(false);
    show.click();
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(canvas.getByRole("dialog", { name: "Добро пожаловать" })).toBe(
      dialog,
    );
    await expect(
      within(dialog).getByRole("button", {
        name: "Принять условия и продолжить",
      }),
    ).toHaveFocus();
    unmount.click();
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expect(dialog.matches(":modal")).toBe(false);
  },
};
