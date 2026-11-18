import type { Meta, StoryObj } from "@storybook/react-vite";
import Link from "next/link";
import { Activity, useRef, useState } from "react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { ReaderReturnNavigation } from "./reader-return-navigation.client";

function observeNativeResources() {
  return {
    observe: spyOn(IntersectionObserver.prototype, "observe"),
    disconnect: spyOn(IntersectionObserver.prototype, "disconnect"),
  };
}
let nativeResources: ReturnType<typeof observeNativeResources> | undefined;

function ReaderReturnLifetime() {
  const viewport = useRef<HTMLDivElement>(null);
  const [repeat, setRepeat] = useState(true);
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => viewport.current?.scrollTo(0, 500)}
        >
          Прокрутить ниже
        </button>
        <button type="button" onClick={() => viewport.current?.scrollTo(0, 0)}>
          Вернуться наверх
        </button>
        <button
          type="button"
          onClick={() => {
            setRepeat(false);
          }}
        >
          Выключить повтор
        </button>
        <button
          type="button"
          onClick={() => {
            setRepeat(true);
          }}
        >
          Включить повтор
        </button>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
          }}
        >
          Скрыть Reader
        </button>
        <button
          type="button"
          onClick={() => {
            setVisible(true);
          }}
        >
          Вернуть Reader
        </button>
        <button
          type="button"
          onClick={() => {
            setMounted(false);
          }}
        >
          Удалить Reader
        </button>
      </div>
      <div ref={viewport} style={{ height: 250, overflowY: "auto" }}>
        <Activity mode={visible ? "visible" : "hidden"}>
          {mounted ? (
            <ReaderReturnNavigation
              target={homeMaterialReaderReturnTarget}
              repeatAtBottom={repeat}
            >
              <div style={{ height: 900 }}>Содержимое материала</div>
            </ReaderReturnNavigation>
          ) : null}
        </Activity>
      </div>
    </>
  );
}

const meta = {
  ...publicPageEnvironment("/materials/reader-return"),
  title: "Patterns/Reader return lifetime",
  component: ReaderReturnLifetime,
  beforeEach: () => {
    publicPageEnvironment("/materials/reader-return").beforeEach();
    const resources = observeNativeResources();
    nativeResources = resources;
    return () => {
      resources.observe.mockRestore();
      resources.disconnect.mockRestore();
      nativeResources = undefined;
    };
  },
} satisfies Meta<typeof ReaderReturnLifetime>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RepeatsOnlyOutsideTheTopViewport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = canvasElement.querySelector<HTMLDivElement>(
      "[data-reader-return='top']",
    );
    if (top === null) throw new Error("Missing top return action");
    await expect(top).toBeVisible();
    await expect(within(top).getByRole("link")).toHaveAttribute("href", "/");
    await expect(
      canvasElement.querySelector("[data-reader-return='bottom']"),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Прокрутить ниже" }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-reader-return='bottom'] a"),
      ).toHaveAttribute("href", "/"),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуться наверх" }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-reader-return='bottom']"),
      ).toBeNull(),
    );
  },
};

export const RetainsTheTopAndReleasesItsObservation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (nativeResources === undefined) throw new Error("Missing native spies");
    const { observe, disconnect } = nativeResources;
    const acquisitions = () =>
      observe.mock.calls.flatMap(([node], index) =>
        node.matches("[data-reader-top-frame]") && canvasElement.contains(node)
          ? [{ node, owner: observe.mock.contexts[index] }]
          : [],
      );
    await waitFor(() => expect(acquisitions()).toHaveLength(1));
    const first = acquisitions()[0];
    if (first === undefined)
      throw new Error("Reader did not acquire observation");
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть Reader" }),
    );
    await waitFor(() => expect(first.node).not.toBeVisible());
    await expect(first.node.isConnected).toBe(true);
    await waitFor(() =>
      expect(disconnect.mock.contexts).toContain(first.owner),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть Reader" }),
    );
    await waitFor(() => expect(first.node).toBeVisible());
    await waitFor(() => expect(acquisitions()).toHaveLength(2));
    await expect(acquisitions().at(-1)?.node).toBe(first.node);
    const returned = acquisitions().at(-1)?.owner;
    await userEvent.click(
      canvas.getByRole("button", { name: "Выключить повтор" }),
    );
    await waitFor(() => expect(disconnect.mock.contexts).toContain(returned));
    const disabledCount = acquisitions().length;
    await userEvent.click(
      canvas.getByRole("button", { name: "Прокрутить ниже" }),
    );
    await expect(
      canvasElement.querySelector("[data-reader-return='bottom']"),
    ).toBeNull();
    await expect(acquisitions()).toHaveLength(disabledCount);
    await userEvent.click(
      canvas.getByRole("button", { name: "Включить повтор" }),
    );
    await waitFor(() => expect(acquisitions()).toHaveLength(disabledCount + 1));
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-reader-return='bottom'] a"),
      ).toHaveAttribute("href", "/"),
    );
    const last = acquisitions().at(-1)?.owner;
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить Reader" }),
    );
    await waitFor(() => expect(first.node.isConnected).toBe(false));
    await waitFor(() => expect(disconnect.mock.contexts).toContain(last));
  },
};

export const HiddenReturnKeepsOnlyChildren: Story = {
  render: () => (
    <ReaderReturnNavigation
      target={homeMaterialReaderReturnTarget}
      repeatAtBottom={false}
      hideReturn
    >
      <p>Только содержимое</p>
    </ReaderReturnNavigation>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Только содержимое")).toBeVisible();
    await expect(
      within(canvas.getByRole("main")).queryByRole("link"),
    ).toBeNull();
    await expect(
      canvasElement.querySelector("[data-reader-top-frame]"),
    ).toBeNull();
  },
};

export const HiddenReturnKeepsProvidedTopNavigation: Story = {
  render: () => (
    <ReaderReturnNavigation
      target={homeMaterialReaderReturnTarget}
      repeatAtBottom={false}
      hideReturn
      topNavigation={<Link href="/account">Своя навигация материала</Link>}
    >
      <p>Содержимое с навигацией</p>
    </ReaderReturnNavigation>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const main = within(canvas.getByRole("main"));
    await expect(
      main.getByRole("link", { name: "Своя навигация материала" }),
    ).toHaveAttribute("href", "/account");
    await expect(main.getAllByRole("link")).toHaveLength(1);
    await expect(main.getByText("Содержимое с навигацией")).toBeVisible();
    await expect(
      canvasElement.querySelector("[data-reader-return='top']"),
    ).toBeNull();
    await expect(
      canvasElement.querySelector("[data-reader-top-frame]"),
    ).toBeVisible();
  },
};
