import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  MaterialAssetUploadQueue,
  type MaterialAssetUploadController,
  type PendingUpload,
} from "./material-asset-upload-controls.client";

const actions = {
  cancel: fn(),
  enqueue: fn(),
  retry: fn(),
};

function upload(
  values: Partial<PendingUpload> &
    Pick<PendingUpload, "id" | "kind" | "status">,
): PendingUpload {
  const { id, kind, status, ...overrides } = values;
  const file = new File(
    ["Inside asset"],
    kind === "image" ? "scheme.png" : "guide.pdf",
    {
      type: kind === "image" ? "image/png" : "application/pdf",
    },
  );
  return {
    file,
    id,
    idempotencyKey: `storybook-${id}`,
    insertAt: 1,
    kind,
    progress: 0,
    retryWithNewIdempotencyKey: false,
    status,
    ...overrides,
  };
}

function controller(
  uploads: readonly PendingUpload[],
): MaterialAssetUploadController {
  return { ...actions, uploads };
}

const meta = {
  component: MaterialAssetUploadQueue,
  parameters: { layout: "padded" },
  title: "Функции/Редактор/Загрузка файлов",
} satisfies Meta<typeof MaterialAssetUploadQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProgressAndProcessing: Story = {
  args: {
    controller: controller([
      upload({
        id: "uploading",
        kind: "image",
        progress: 63,
        status: "uploading",
      }),
      upload({
        id: "processing",
        kind: "file",
        progress: 100,
        status: "processing",
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("progressbar", { name: "Загрузка scheme.png" }),
    ).toHaveAttribute("value", "63");
    await expect(
      canvas.getByText("Проверяем и подготавливаем файл…"),
    ).toBeInTheDocument();
    await expect(
      canvas.getAllByRole("button", { name: "Отменить загрузку" }),
    ).toHaveLength(2);
  },
};

export const ErrorAndRetry: Story = {
  args: {
    controller: controller([
      upload({
        id: "failed",
        kind: "file",
        message: "Не удалось загрузить. Локальный текст сохранён",
        status: "error",
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Повторить загрузку" }),
    );
    await expect(actions.retry).toHaveBeenCalledWith("failed");
    await expect(
      canvas.getByText("Не удалось загрузить. Локальный текст сохранён"),
    ).toBeInTheDocument();
  },
};
