import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { authoringPageEnvironment } from "@/storybook/story-environment";

import type { MaterialAuthoringVideo } from "../model/video";
import { MaterialVideoAuthoringView } from "./material-video-authoring.client";

/** Видео, загруженное через платформу: его можно убрать из материала и удалить из Kinescope. */
const platformVideo: MaterialAuthoringVideo = {
  origin: "platform_upload",
  state: "ready",
  title: "Разбор проверки skill contract",
  videoId: "03000000-0000-4000-8000-000000000001",
};

/** Раздел видео стоит в редакторе материала, внутри авторской оболочки. */
const meta = {
  ...authoringPageEnvironment(
    "/authoring/materials/02000000-0000-4000-8000-000000000010",
  ),
  component: MaterialVideoAuthoringView,
  args: {
    access: "closed",
    activeVideo: null,
    deletionPendingSave: false,
    deletionVideo: null,
    disabled: false,
    onAttach: fn(),
    onDeleteOwned: fn(),
    onFileSelected: fn(),
    onProviderVideoIdChange: fn(),
    onReconcile: fn(),
    onRemove: fn(),
    onRetryDeletion: fn(),
    phase: "idle",
    progress: 47,
    providerVideoId: "",
    recovered: false,
  },
  parameters: {
    docs: {
      description: {
        component:
          "Основное видео в редакторе материала. Истории передают только состояние представления; загрузка, Kinescope API и правила доступа остаются за production adapters.",
      },
    },
  },
  title: "Components/Material video/Authoring",
} satisfies Meta<typeof MaterialVideoAuthoringView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AuthoringIdle: Story = {
  name: "Authoring · idle",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Основное видео не выбрано")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Загрузить" }),
    ).toBeEnabled();
  },
};

export const AuthoringUploading: Story = {
  args: { phase: "uploading" },
  name: "Authoring · uploading",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Загрузка 47%")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Загрузить" }),
    ).toBeDisabled();
  },
};

export const AuthoringRecoveredChecking: Story = {
  args: {
    activeVideo: { ...platformVideo, state: "processing" },
    phase: "processing",
    recovered: true,
  },
  name: "Authoring · adopted upload is being checked",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/осталось от незавершённой загрузки/u),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Удалить…" }),
    ).toBeEnabled();
  },
};

export const AuthoringRecoveredIncomplete: Story = {
  args: {
    activeVideo: { ...platformVideo, state: "uploading" },
    phase: "interrupted_unusable",
    recovered: true,
  },
  name: "Authoring · adopted upload never finished",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Загрузка не завершена")).toBeVisible();
    await expect(
      canvas.getByText(/получил файл .* не полностью/u),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Загрузить" }),
    ).toBeEnabled();
    // Another tab may still be sending the same file, so re-checking stays available.
    await expect(
      canvas.getByRole("button", { name: "Проверить" }),
    ).toBeEnabled();
  },
};

export const AuthoringRecoveredFailed: Story = {
  args: {
    activeVideo: { ...platformVideo, state: "failed" },
    phase: "interrupted_unusable",
    recovered: true,
  },
  name: "Authoring · adopted upload Kinescope could not process",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/не смог обработать файл/u)).toBeVisible();
    await expect(
      canvas.queryByText("Нужна повторная попытка"),
    ).not.toBeInTheDocument();
    // A terminal provider failure cannot be checked away.
    await expect(
      canvas.queryByRole("button", { name: "Проверить" }),
    ).not.toBeInTheDocument();
  },
};

export const AuthoringProcessing: Story = {
  args: {
    activeVideo: { ...platformVideo, state: "processing" },
    phase: "processing",
  },
  name: "Authoring · processing",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Kinescope обрабатывает видео"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Проверить" }),
    ).toBeDisabled();
  },
};

export const AuthoringReady: Story = {
  args: { activeVideo: platformVideo, phase: "ready" },
  name: "Authoring · ready",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Видео готово")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Убрать" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Удалить…" }));
    await expect(
      within(document.body).getByRole("heading", {
        name: "Удалить «Разбор проверки skill contract» из Kinescope?",
      }),
    ).toBeVisible();
  },
};

export const AuthoringExternalReady: Story = {
  args: {
    activeVideo: { ...platformVideo, origin: "external_attachment" },
    phase: "ready",
  },
  name: "Authoring · external attachment is detach-only",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Убрать" })).toBeEnabled();
    await expect(
      canvas.queryByRole("button", { name: "Удалить…" }),
    ).not.toBeInTheDocument();
  },
};

export const AuthoringDeletionPendingSave: Story = {
  args: { deletionPendingSave: true, deletionVideo: platformVideo },
  name: "Authoring · deletion autosaving",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/сохраняется…/u),
    ).toBeVisible();
  },
};

export const AuthoringDeletionRequested: Story = {
  args: {
    deletionVideo: { ...platformVideo, state: "deletion_requested" },
  },
  name: "Authoring · deletion requested",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/удаление.*запрошено/i),
    ).toBeVisible();
  },
};

export const AuthoringDeleting: Story = {
  args: { deletionVideo: { ...platformVideo, state: "deleting" } },
  name: "Authoring · deleting",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/удаляется из Kinescope/),
    ).toBeVisible();
  },
};

export const AuthoringDeleted: Story = {
  args: { deletionVideo: { ...platformVideo, state: "deleted" } },
  name: "Authoring · deleted",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/удалено из Kinescope/),
    ).toBeVisible();
  },
};

export const AuthoringDeleteFailed: Story = {
  args: {
    deletionVideo: { ...platformVideo, state: "delete_failed" },
  },
  name: "Authoring · delete failed and retry",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Не удалось удалить/)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Повторить удаление" }),
    ).toBeEnabled();
  },
};

export const AuthoringError: Story = {
  args: {
    activeVideo: { ...platformVideo, state: "failed" },
    phase: "error",
  },
  name: "Authoring · error and retry",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Нужна повторная попытка")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Проверить" }),
    ).toBeEnabled();
  },
};

export const UploadNotAuthorized: Story = {
  args: { phase: "upload_not_authorized" },
  name: "Authoring · upload authorization denied",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        "Kinescope отклонил загрузку. Нужно исправить права доступа к сервису.",
      ),
    ).toBeVisible();
  },
};

export const UploadOutcomeUnknown: Story = {
  args: { phase: "upload_outcome_unknown" },
  name: "Authoring · upload outcome unknown",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        "Результат загрузки не подтверждён. Нужна проверка в Kinescope перед повтором.",
      ),
    ).toBeVisible();
  },
};
