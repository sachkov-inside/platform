import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MaterialSvgFigure } from "./material-svg-figure.client";

function RetainedFigure() {
  const [visible, setVisible] = useState(true);
  return (
    <div style={{ width: "min(720px, 100%)" }}>
      <button
        onClick={() => {
          setVisible(false);
        }}
        type="button"
      >
        Скрыть материал
      </button>
      <button
        onClick={() => {
          setVisible(true);
        }}
        type="button"
      >
        Вернуть материал
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <span>Материал открыт</span>
        <MaterialSvgFigure
          alt="Сохранённая схема"
          height={240}
          width={720}
          preview
          src="/api/materials/02000000-0000-4000-8000-000000000010/assets/figure-wide.svg/images/720"
          srcSet=""
          viewerSize={{ height: 240, width: 720 }}
        />
      </Activity>
    </div>
  );
}

const meta = {
  title: "Features/Material assets/Lifetime",
  component: RetainedFigure,
} satisfies Meta<typeof RetainedFigure>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Retained routes must never resume a viewer whose blob URL has already been revoked. */
export const RetainedSvgViewer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", {
      name: "Открыть изображение крупно: Сохранённая схема",
    });
    trigger.click();
    const dialog = await canvas.findByRole("dialog");
    const image = await within(dialog).findByRole("img");
    await waitFor(() => expect(image).toHaveProperty("naturalWidth", 720));
    // Route retention is programmatic, including when the modal blocks page controls.
    canvas.getByRole("button", { name: "Скрыть материал" }).click();
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    canvas.getByRole("button", { name: "Вернуть материал" }).click();
    await waitFor(() =>
      expect(canvas.getByText("Материал открыт")).toBeVisible(),
    );
    await waitFor(async () => {
      const resumed = canvas.queryByRole("dialog");
      // Either the viewer closes on retention, or it resumes with a live decoded resource.
      if (resumed === null) {
        await expect(
          canvas.getByRole("button", {
            name: "Открыть изображение крупно: Сохранённая схема",
          }),
        ).toBeVisible();
        return;
      }
      const resumedImage = within(resumed).getByRole<HTMLImageElement>("img");
      await expect(resumedImage).toHaveProperty("naturalWidth", 720);
      const readable = await fetch(resumedImage.src).then(
        (response) => response.ok,
        () => false,
      );
      await expect(readable).toBe(true);
    });
    const resumed = canvas.queryByRole("dialog");
    if (resumed !== null)
      await userEvent.click(
        within(resumed).getByRole("button", { name: "Закрыть" }),
      );
    const returnedTrigger = await canvas.findByRole("button", {
      name: "Открыть изображение крупно: Сохранённая схема",
    });
    returnedTrigger.click();
    const reopened = await canvas.findByRole("dialog");
    await waitFor(() =>
      expect(within(reopened).getByRole("img")).toHaveProperty(
        "naturalWidth",
        720,
      ),
    );
    await userEvent.click(
      within(reopened).getByRole("button", { name: "Закрыть" }),
    );
    await expect(returnedTrigger).toHaveFocus();
  },
};

const wideSource =
  "/api/materials/02000000-0000-4000-8000-000000000010/assets/figure-wide.svg/images/720?contentVersion=1";
const tallSource =
  "/api/materials/02000000-0000-4000-8000-000000000010/assets/figure-tall.svg/images/360?contentVersion=2&preview=true";

function ChangingSource() {
  const [src, setSrc] = useState(wideSource);
  return (
    <div style={{ width: "min(720px, 100%)" }}>
      <button
        type="button"
        onClick={() => {
          setSrc(tallSource);
        }}
      >
        Другая версия
      </button>
      <MaterialSvgFigure
        alt="Версия схемы"
        src={src}
        srcSet=""
        height={240}
        width={720}
        preview
      />
    </div>
  );
}

/** An old, already delivered HTTP response must not enter the DOM after a source/version change. */
export const LateSvgSource: Story = {
  render: () => <ChangingSource />,
  beforeEach: () => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const address = input instanceof Request ? input.url : String(input);
      if (address !== wideSource && address !== tallSource)
        return original(input, init);
      // The real fixture HTTP response is held after arrival, even if cancellation reaches it late.
      const response = await original(input);
      if (address === wideSource) {
        document.documentElement.dataset["heldSvg"] = "arrived";
        await new Promise<void>((resolve) => {
          window.addEventListener(
            "release-held-svg",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        document.documentElement.dataset["heldSvg"] = "released";
      }
      return response;
    };
    return () => {
      window.dispatchEvent(new Event("release-held-svg"));
      window.fetch = original;
      delete document.documentElement.dataset["heldSvg"];
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(document.documentElement.dataset["heldSvg"]).toBe("arrived"),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Другая версия" }),
    );
    const host = await canvas.findByRole("img", { name: "Версия схемы" });
    await waitFor(() =>
      expect(host.querySelector("svg")?.id).toBe("fig-agent-loop-tall"),
    );
    window.dispatchEvent(new Event("release-held-svg"));
    await waitFor(() =>
      expect(document.documentElement.dataset["heldSvg"]).toBe("released"),
    );
    await userEvent.tab();
    await expect(host.querySelector("svg")?.id).toBe("fig-agent-loop-tall");
    await expect(
      canvasElement.querySelector("#fig-agent-loop-wide"),
    ).toBeNull();
  },
};

export const SvgMobileClose: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", {
      name: "Открыть изображение крупно: Сохранённая схема",
    });
    trigger.click();
    const dialog = await canvas.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть" }),
    );
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};
