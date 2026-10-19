import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, within } from "storybook/test";

import { MaterialShareButton } from "./material-share-button.client";
import { MaterialCard } from "./material-card";
import type { MaterialPreview } from "../model/material-preview";

const meta = {
  title: "Components/Material Sharing",
  component: MaterialShareButton,
  args: { slug: "first-material", title: "Первый материал" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof MaterialShareButton>;
export default meta;
type Story = StoryObj<typeof meta>;

function replaceShare(value: Navigator["share"] | undefined) {
  const previous = Object.getOwnPropertyDescriptor(navigator, "share");
  Object.defineProperty(navigator, "share", { configurable: true, value });
  return () => {
    if (previous === undefined) Reflect.deleteProperty(navigator, "share");
    else Object.defineProperty(navigator, "share", previous);
  };
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: "Поделиться материалом «Первый материал»",
    });
    await expect(button).toBeVisible();
    await expect(button).toHaveTextContent("");
    await expect(button).toHaveAttribute("title", "Поделиться");
  },
};

export const CopyLink: Story = {
  beforeEach: () => replaceShare(undefined),
  play: async ({ canvasElement }) => {
    const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button"));
      await expect(
        canvas.findByText("Ссылка скопирована"),
      ).resolves.toBeInTheDocument();
      await expect(canvas.getByRole("button")).toHaveAttribute(
        "title",
        "Ссылка скопирована",
      );
      await expect(canvas.getByRole("button")).toHaveTextContent("");
      await expect(copy).toHaveBeenCalledWith(
        `${window.location.origin}/materials/first-material`,
      );
    } finally {
      copy.mockRestore();
    }
  },
};

const nativeShare = fn<Navigator["share"]>().mockResolvedValue(undefined);
export const NativeMenu: Story = {
  beforeEach: () => {
    nativeShare.mockClear();
    return replaceShare(nativeShare);
  },
  play: async ({ canvasElement }) => {
    const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button"));
      await expect(nativeShare).toHaveBeenCalledWith({
        title: "Первый материал",
        url: `${window.location.origin}/materials/first-material`,
      });
      await expect(canvas.getByRole("button")).toBeEnabled();
      await expect(copy).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
    }
  },
};

export const CancelMenu: Story = {
  beforeEach: () =>
    replaceShare(() =>
      Promise.reject(new DOMException("Cancelled", "AbortError")),
    ),
  play: async ({ canvasElement }) => {
    const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button"));
      await expect(canvas.getByRole("button")).toBeEnabled();
      await expect(
        canvas.queryByText("Ссылка скопирована"),
      ).not.toBeInTheDocument();
      await expect(copy).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
    }
  },
};

export const ManualCopy: Story = {
  beforeEach: () => replaceShare(undefined),
  play: async ({ canvasElement }) => {
    const copy = spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button"));
      const field = await canvas.findByRole("textbox");
      await expect(field).toHaveValue(
        `${window.location.origin}/materials/first-material`,
      );
      await userEvent.click(field);
      await expect(field).toHaveProperty("selectionStart", 0);
      await expect(field).toHaveProperty(
        "selectionEnd",
        `${window.location.origin}/materials/first-material`.length,
      );
    } finally {
      copy.mockRestore();
    }
  },
};

export const NativeUnavailable: Story = {
  ...CopyLink,
  beforeEach: () =>
    replaceShare(() =>
      Promise.reject(new DOMException("Policy blocked", "NotAllowedError")),
    ),
};

const material: MaterialPreview = {
  access: "free",
  availability: "available",
  format: "Заметка",
  formatSlug: "note",
  seriesMemberships: [],
  slug: "first-material",
  summary: "Как постоянные ссылки помогают делиться полезными материалами.",
  tags: [],
  title: "Первый материал",
  topic: "Разработка",
  topicSlug: "development",
};

export const Cards: Story = {
  render: () => (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <MaterialCard material={material} variant="feed" />
      <MaterialCard material={material} variant="row" />
      <MaterialCard material={material} variant="series" />
    </div>
  ),
};

export const CardsMobile: Story = {
  ...Cards,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const CompactManualCopy: Story = {
  ...ManualCopy,
  render: () => <MaterialCard material={material} variant="series" />,
  globals: { viewport: { value: "mobile320", isRotated: false } },
};
