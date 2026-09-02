import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  MaterialVideoAuthoringView,
  MaterialVideoPlayerView,
  type MaterialVideoAuthoringPhase,
} from "@/features/material-video";

type VideoStoryMode =
  | "authoring-error"
  | "authoring-idle"
  | "authoring-processing"
  | "authoring-ready"
  | "authoring-uploading"
  | "player-error";

const actions = {
  onAttach: fn(),
  onFileSelected: fn(),
  onLoad: fn(),
  onProviderVideoIdChange: fn(),
  onReconcile: fn(),
  onRemove: fn(),
};

function MaterialVideoStateBoard({ mode }: { readonly mode: VideoStoryMode }) {
  if (mode === "player-error") {
    return (
      <div className="mx-auto max-w-5xl p-5 sm:p-8">
        <MaterialVideoPlayerView
          onLoad={actions.onLoad}
          phase="error"
          title="Разбор проверки skill contract"
          videoId="03000000-0000-4000-8000-000000000001"
        />
      </div>
    );
  }

  const phase = mode.replace("authoring-", "") as MaterialVideoAuthoringPhase;
  const hasVideo = phase === "processing" || phase === "ready" || phase === "error";
  return (
    <div className="mx-auto max-w-4xl p-5 sm:p-8">
      <MaterialVideoAuthoringView
        access="membership"
        activeVideoId={hasVideo ? "03000000-0000-4000-8000-000000000001" : null}
        disabled={false}
        onAttach={actions.onAttach}
        onFileSelected={actions.onFileSelected}
        onProviderVideoIdChange={actions.onProviderVideoIdChange}
        onReconcile={actions.onReconcile}
        onRemove={actions.onRemove}
        phase={phase}
        progress={47}
        providerVideoId=""
        title={hasVideo ? "Разбор проверки skill contract" : null}
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
    await expect(canvas.getByRole("button", { name: "Убрать" })).toBeEnabled();
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
    await expect(canvas.getByText("Player сейчас недоступен. Можно безопасно повторить.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Повторить" })).toBeEnabled();
  },
};
