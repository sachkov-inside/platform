import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { withMutationFetch } from "@/workshop/mutation-mock";
import { ContentCoverEditor } from "./content-cover-editor.client";

const ownerId = "72000000-0000-4000-8000-000000000002";

const meta = {
  args: {
    initialCover: null,
    ownerId,
    ownerKind: "topic",
    ownerLabel: "Platform",
  },
  component: ContentCoverEditor,
  parameters: { layout: "padded" },
  title: "Components/Content Cover editor",
} satisfies Meta<typeof ContentCoverEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MissingCover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Загрузить")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
  },
};

export const Processing: Story = {
  decorators: [withMutationFetch(() => new Promise<Response>(() => undefined))],
  play: async ({ canvasElement }) => {
    await uploadFixture(canvasElement);
    await waitFor(() =>
      expect(within(canvasElement).getByText("Обрабатываем…")).toBeVisible(),
    );
    await expect(within(canvasElement).getByRole("region", { name: "Обложка: Platform" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  },
};

export const ServiceError: Story = {
  decorators: [
    withMutationFetch(() => Promise.resolve(new Response(null, { status: 503 }))),
  ],
  play: async ({ canvasElement }) => {
    await uploadFixture(canvasElement);
    await expect(
      within(canvasElement).findByRole("alert"),
    ).resolves.toHaveTextContent("Не удалось обновить обложку.");
  },
};

export const ConcurrentChange: Story = {
  decorators: [
    withMutationFetch(() => Promise.resolve(new Response(null, { status: 409 }))),
  ],
  play: async ({ canvasElement }) => {
    await uploadFixture(canvasElement);
    await expect(
      within(canvasElement).findByRole("alert"),
    ).resolves.toHaveTextContent("Обложка уже изменилась.");
  },
};

async function uploadFixture(canvasElement: HTMLElement): Promise<void> {
  const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("Content Cover file input is missing");
  await userEvent.upload(
    input,
    new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
  );
}


const landscapeCover = { coverId: "27100000-0000-4000-8000-000000000005", renditions: [{ width: 960, height: 540 }] };

export const MaterialPreview: Story = {
  args: { initialCover: landscapeCover, ownerKind: "material", ownerLabel: "Обложка материала" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const name of ["Превью 16:9", "Квадратное превью"]) {
      const image = canvas.getByRole<HTMLImageElement>("img", { name });
      await waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
      await expect(image.naturalWidth / image.naturalHeight).toBeCloseTo(16 / 9, 1);
      await expect(getComputedStyle(image).objectFit).toBe("cover");
      await expect(getComputedStyle(image).objectPosition).toBe("50% 50%");
      const box = image.getBoundingClientRect();
      await expect(box.width / box.height).toBeCloseTo(name === "Превью 16:9" ? 16 / 9 : 1, 1);
    }
    await expect(canvas.getByText("Заменить")).toBeVisible();
  },
};
export const MaterialPreviewMobile: Story = { ...MaterialPreview, globals: { viewport: { value: "mobile320", isRotated: false } } };
export const UploadMaterialCover: Story = {
  args: { ownerKind: "material" },
  decorators: [withMutationFetch(() => Promise.resolve(Response.json({ cover: landscapeCover })))],
  play: async (context) => {
    await uploadFixture(context.canvasElement);
    await expect(within(context.canvasElement).findByRole("status")).resolves.toHaveTextContent("Обложка обновлена.");
    await MaterialPreview.play?.(context);
  },
};
