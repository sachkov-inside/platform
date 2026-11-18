import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useCallback, useState } from "react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";

import { InfiniteMaterialCatalog } from "./material-catalog.client";

type PageState = "ready" | "pending" | "error" | "exhausted";

function observeNativeResources() {
  return {
    observe: spyOn(IntersectionObserver.prototype, "observe"),
    disconnect: spyOn(IntersectionObserver.prototype, "disconnect"),
  };
}
let nativeResources: ReturnType<typeof observeNativeResources> | undefined;

function CatalogLifetime() {
  const [state, setState] = useState<PageState>("ready");
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [requests, setRequests] = useState(0);
  const loadNextPage = useCallback(() => {
    setRequests((count) => count + 1);
  }, []);
  return (
    <>
      <div>
        {(["ready", "pending", "error", "exhausted"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setState(value);
            }}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setVisible(false);
          }}
        >
          Скрыть каталог
        </button>
        <button
          type="button"
          onClick={() => {
            setVisible(true);
          }}
        >
          Вернуть каталог
        </button>
        <button
          type="button"
          onClick={() => {
            setMounted(false);
          }}
        >
          Удалить каталог
        </button>
        <output aria-label="Запросы продолжения">{requests}</output>
      </div>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <InfiniteMaterialCatalog
            hasNextPage={state !== "exhausted"}
            isFetchNextPageError={state === "error"}
            isFetchingNextPage={state === "pending"}
            onLoadNextPage={loadNextPage}
            pages={[]}
            totalCount={23}
            withoutHeading
          />
        ) : null}
      </Activity>
    </>
  );
}

const meta = {
  ...publicPageEnvironment("/"),
  title: "Patterns/Catalog continuation lifetime",
  component: CatalogLifetime,
  beforeEach: () => {
    publicPageEnvironment("/").beforeEach();
    const resources = observeNativeResources();
    nativeResources = resources;
    return () => {
      resources.observe.mockRestore();
      resources.disconnect.mockRestore();
      nativeResources = undefined;
    };
  },
} satisfies Meta<typeof CatalogLifetime>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RetainsCatalogAndReleasesObservation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const requests = canvas.getByRole("status", {
      name: "Запросы продолжения",
    });
    if (nativeResources === undefined)
      throw new Error("Native observation was not installed before render");
    const { observe, disconnect } = nativeResources;
    const acquisitions = () =>
      observe.mock.calls.flatMap(([node], index) =>
        node.parentElement?.matches("[data-library-state='ready']") === true &&
        canvasElement.contains(node)
          ? [{ node, owner: observe.mock.contexts[index] }]
          : [],
      );
    await waitFor(() => expect(requests).toHaveTextContent("1"));
    const first = acquisitions()[0];
    if (first === undefined)
      throw new Error("Catalog did not acquire observation");
    if (!(first.owner instanceof IntersectionObserver))
      throw new Error("Catalog observation has no native owner");
    await expect(first.owner.rootMargin).toBe("800px 0px 800px 0px");
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть каталог" }),
    );
    await waitFor(() => expect(first.node).not.toBeVisible());
    await expect(first.node.isConnected).toBe(true);
    await waitFor(() =>
      expect(disconnect.mock.contexts).toContain(first.owner),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть каталог" }),
    );
    await waitFor(() => expect(requests).toHaveTextContent("2"));
    await expect(acquisitions().at(-1)?.node).toBe(first.node);
    const returned = acquisitions().at(-1)?.owner;
    await userEvent.click(canvas.getByRole("button", { name: "pending" }));
    await canvas.findByText("Загружаем ещё материалы…");
    await waitFor(() => expect(disconnect.mock.contexts).toContain(returned));
    await userEvent.click(canvas.getByRole("button", { name: "error" }));
    await canvas.findByText("Не удалось загрузить продолжение каталога.");
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(requests).toHaveTextContent("3"));
    await userEvent.click(canvas.getByRole("button", { name: "exhausted" }));
    await canvas.findByText("Все материалы загружены");
    await expect(
      canvas.queryByRole("button", { name: "Показать ещё" }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "ready" }));
    await waitFor(() => expect(requests).toHaveTextContent("4"));
    await userEvent.click(canvas.getByRole("button", { name: "Показать ещё" }));
    await waitFor(() => expect(requests).toHaveTextContent("5"));
    const last = acquisitions().at(-1)?.owner;
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить каталог" }),
    );
    await waitFor(() => expect(first.node.isConnected).toBe(false));
    await waitFor(() => expect(disconnect.mock.contexts).toContain(last));
  },
};
