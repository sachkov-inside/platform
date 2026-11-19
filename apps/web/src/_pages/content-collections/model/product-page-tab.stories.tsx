import { Activity } from "react";
import { expect } from "storybook/test";
import { flushSync } from "react-dom";
import { committedRoot } from "@/storybook/committed-root";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { useProductPageTab } from "./use-product-page-tab.client";

const product = "/authoring/products/first";
const meta = {
  title: "Patterns/Authoring/Product tab history",
  beforeEach: authoringPageEnvironment(product).beforeEach,
};
export default meta;
function Tabs() {
  const [selected, select] = useProductPageTab();
  return (
    <>
      <output>{selected}</output>
      <button
        type="button"
        onClick={() => {
          select("program");
        }}
      >
        Программа
      </button>
    </>
  );
}
export const ActiveHistoryOwner = {
  render: () => <div />,
  play: async () => {
    const host = document.createElement("div");
    const root = committedRoot(host);
    const href = location.href;
    const state: unknown = history.state;
    function paint(mode: "visible" | "hidden") {
      root.show(
        <Activity mode={mode}>
          <Tabs />
        </Activity>,
      );
    }
    function pop(path: string) {
      history.replaceState(null, "", path);
      flushSync(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    }
    try {
      history.replaceState(null, "", product);
      paint("visible");
      const output = host.querySelector("output");
      const button = host.querySelector("button");
      if (!output || !button) throw new Error("Missing tab controls");
      await expect(output).toHaveTextContent("overview");
      flushSync(() => {
        button.click();
      });
      await expect(output).toHaveTextContent("program");
      pop("/authoring/products/second");
      await expect(output).toHaveTextContent("program");
      paint("hidden");
      pop(product);
      paint("visible");
      await expect(output).toHaveTextContent("program");
      pop(product);
      await expect(output).toHaveTextContent("overview");
    } finally {
      root.unmount();
      history.replaceState(state, "", href);
    }
  },
};
