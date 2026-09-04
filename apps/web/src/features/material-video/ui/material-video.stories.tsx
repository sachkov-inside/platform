import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  MaterialVideoAuthoringView,
  MaterialVideoPlayerView,
  type MaterialVideoAuthoringPhase,
} from "@/features/material-video";

type VideoStoryMode =
  | "authoring-delete-failed"
  | "authoring-deleted"
  | "authoring-deleting"
  | "authoring-deletion-pending-save"
  | "authoring-deletion-requested"
  | "authoring-error"
  | "authoring-external-ready"
  | "authoring-idle"
  | "authoring-processing"
  | "authoring-ready"
  | "authoring-uploading"
  | "player-error";

const actions = {
  onAttach: fn(),
  onDeleteOwned: fn(),
  onFileSelected: fn(),
  onLoad: fn(),
  onProviderVideoIdChange: fn(),
  onReconcile: fn(),
  onRemove: fn(),
  onRetryDeletion: fn(),
};

function MaterialVideoStateBoard({ mode }: { readonly mode: VideoStoryMode }) {
  if (mode === "player-error") {
    return (
      <div className="mx-auto max-w-5xl p-5 sm:p-8">
        <MaterialVideoPlayerView
          onLoad={actions.onLoad}
          onToggleWatched={fn()}
          phase="error"
          title="Разбор проверки skill contract"
          videoId="03000000-0000-4000-8000-000000000001"
        />
      </div>
    );
  }

  const deletionState = mode === "authoring-deletion-requested"
    ? "deletion_requested" as const
    : mode === "authoring-deleting"
      ? "deleting" as const
      : mode === "authoring-deleted"
        ? "deleted" as const
        : mode === "authoring-delete-failed"
          ? "delete_failed" as const
          : null;
  const phase = mode === "authoring-external-ready"
    ? "ready"
    : mode.includes("deletion") || mode === "authoring-delete-failed"
      ? "idle"
      : mode.replace("authoring-", "") as MaterialVideoAuthoringPhase;
  const hasVideo = phase === "processing" || phase === "ready" || phase === "error";
  return (
    <div className="mx-auto max-w-4xl p-5 sm:p-8">
      <MaterialVideoAuthoringView
        access="membership"
        activeVideo={hasVideo ? {
          origin: mode === "authoring-external-ready" ? "external_attachment" : "platform_upload",
          state: phase === "ready" ? "ready" : phase === "error" ? "failed" : "processing",
          title: "Разбор проверки skill contract",
          videoId: "03000000-0000-4000-8000-000000000001",
        } : null}
        deletionPendingSave={mode === "authoring-deletion-pending-save"}
        deletionVideo={deletionState === null && mode !== "authoring-deletion-pending-save" ? null : {
          origin: "platform_upload",
          state: deletionState ?? "ready",
          title: "Разбор проверки skill contract",
          videoId: "03000000-0000-4000-8000-000000000001",
        }}
        disabled={false}
        onAttach={actions.onAttach}
        onDeleteOwned={actions.onDeleteOwned}
        onFileSelected={actions.onFileSelected}
        onProviderVideoIdChange={actions.onProviderVideoIdChange}
        onReconcile={actions.onReconcile}
        onRemove={actions.onRemove}
        onRetryDeletion={actions.onRetryDeletion}
        phase={phase}
        progress={47}
        providerVideoId=""
      />
    </div>
  );
}

const meta = {
  args: { mode: "authoring-idle" },
  component: MaterialVideoStateBoard,
  parameters: {
    docs: {
      description: {
        component:
          "Production-owned authoring и player shells. Stories передают только presentation state; upload, Kinescope API и access policy остаются за production adapters.",
      },
    },
  },
  title: "Components/Material video/Operational states",
} satisfies Meta<typeof MaterialVideoStateBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AuthoringIdle: Story = {
  name: "Authoring · idle",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Основное видео не выбрано")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Загрузить" })).toBeEnabled();
  },
};

export const AuthoringUploading: Story = {
  args: { mode: "authoring-uploading" },
  name: "Authoring · uploading",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Загрузка 47%")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Загрузить" })).toBeDisabled();
  },
};

export const AuthoringProcessing: Story = {
  args: { mode: "authoring-processing" },
  name: "Authoring · processing",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Kinescope обрабатывает видео")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Проверить" })).toBeEnabled();
  },
};

export const AuthoringReady: Story = {
  args: { mode: "authoring-ready" },
  name: "Authoring · ready",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Готово к Save")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Убрать из материала" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: /удалить из Kinescope/i }));
    await expect(within(document.body).getByRole("heading", {
      name: "Удалить «Разбор проверки skill contract» из Kinescope?",
    })).toBeVisible();
  },
};

export const AuthoringExternalReady: Story = {
  args: { mode: "authoring-external-ready" },
  name: "Authoring · external attachment is detach-only",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/не удалит его в Kinescope/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /удалить из Kinescope/i })).not.toBeInTheDocument();
  },
};

export const AuthoringDeletionPendingSave: Story = {
  args: { mode: "authoring-deletion-pending-save" },
  name: "Authoring · deletion waits for Save",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/будет запрошено только после Save/)).toBeVisible();
  },
};

export const AuthoringDeletionRequested: Story = {
  args: { mode: "authoring-deletion-requested" },
  name: "Authoring · deletion requested",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/удаление.*запрошено/i)).toBeVisible();
  },
};

export const AuthoringDeleting: Story = {
  args: { mode: "authoring-deleting" },
  name: "Authoring · deleting",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/удаляется из Kinescope/)).toBeVisible();
  },
};

export const AuthoringDeleted: Story = {
  args: { mode: "authoring-deleted" },
  name: "Authoring · deleted",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/удалено из Kinescope/)).toBeVisible();
  },
};

export const AuthoringDeleteFailed: Story = {
  args: { mode: "authoring-delete-failed" },
  name: "Authoring · delete failed and retry",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Не удалось удалить/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Повторить удаление" })).toBeEnabled();
  },
};

export const AuthoringError: Story = {
  args: { mode: "authoring-error" },
  name: "Authoring · error and retry",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Нужна повторная попытка")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Проверить" })).toBeEnabled();
  },
};

export const PlayerErrorAndRetry: Story = {
  args: { mode: "player-error" },
  name: "Player · error and retry",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Видео сейчас недоступно. Можно безопасно повторить.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Повторить" })).toBeEnabled();
  },
};
