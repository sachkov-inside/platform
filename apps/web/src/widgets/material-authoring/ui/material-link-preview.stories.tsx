import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, within } from "storybook/test";

import { MaterialLinkPreview } from "./material-link-preview.client";

const meta = {
  title: "Функции/Редактор/Предпросмотр ссылки",
  component: MaterialLinkPreview,
  args: {
    cover: null,
    title: "Как устроен Inside",
    description:
      "От заметки к работающему продукту: решения, код и инженерная практика.",
    published: false,
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof MaterialLinkPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AutomaticImage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("img", {
        name: "Автоматическая картинка: Как устроен Inside",
      }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Скопировать ссылку" }),
    ).not.toBeInTheDocument();
  },
};

export const WithCover: Story = {
  args: {
    cover: {
      coverId: "27100000-0000-4000-8000-000000000005",
      renditions: [{ width: 960, height: 540 }],
    },
  },
  play: async ({ canvasElement }) => {
    const image = within(canvasElement).getByRole("img", {
      name: "Как устроен Inside",
    });
    await expect(image).toHaveAttribute(
      "src",
      "/api/content-covers/27100000-0000-4000-8000-000000000005/960",
    );
  },
};

export const Empty: Story = { args: { title: "", description: "" } };
export const LongTitleMobile: Story = {
  args: {
    title:
      "Как спроектировать удобную платформу для материалов, сохранить контекст инженерных решений и довести первую версию до публикации",
  },
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const LiveEdits: Story = {
  render: function LiveLinkPreview(args) {
    const [title, setTitle] = useState(args.title);
    return (
      <>
        <label>
          Название для проверки
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
            }}
          />
        </label>
        <MaterialLinkPreview {...args} title={title} />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", {
      name: "Название для проверки",
    });
    await userEvent.clear(field);
    await userEvent.type(field, "Новое название");
    await expect(
      canvas.getByRole("img", {
        name: "Автоматическая картинка: Новое название",
      }),
    ).toBeVisible();
  },
};

export const CopyPublishedLink: Story = {
  args: {
    published: true,
    getPublicUrl: fn(() =>
      Promise.resolve("https://sachkov.dev/materials/kak-ustroen-inside"),
    ),
  },
  play: async ({ canvasElement }) => {
    const clipboard = spyOn(navigator.clipboard, "writeText").mockResolvedValue(
      undefined,
    );
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "Скопировать ссылку" }),
      );
      await expect(
        canvas.findByText("Ссылка скопирована."),
      ).resolves.toBeVisible();
      await expect(clipboard).toHaveBeenCalledWith(
        "https://sachkov.dev/materials/kak-ustroen-inside",
      );
    } finally {
      clipboard.mockRestore();
    }
  },
};

export const CopyManually: Story = {
  args: { ...CopyPublishedLink.args },
  play: async ({ canvasElement }) => {
    const clipboard = spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Clipboard denied"),
    );
    try {
      const canvas = within(canvasElement);
      await userEvent.click(
        canvas.getByRole("button", { name: "Скопировать ссылку" }),
      );
      await expect(
        canvas.findByRole("textbox", { name: "Адрес материала" }),
      ).resolves.toHaveValue(
        "https://sachkov.dev/materials/kak-ustroen-inside",
      );
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Не удалось скопировать автоматически.",
      );
    } finally {
      clipboard.mockRestore();
    }
  },
};

export const LinkUnavailable: Story = {
  args: {
    published: true,
    getPublicUrl: fn(() => Promise.reject(new Error("Offline"))),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Скопировать ссылку" }),
    );
    await expect(
      canvas.findByText("Не удалось получить ссылку. Повторите попытку."),
    ).resolves.toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Скопировать ссылку" }),
    ).toBeEnabled();
  },
};
