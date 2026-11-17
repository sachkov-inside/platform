import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import { AutosaveActivity } from "@/storybook/autosave-activity";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { MaterialVideoAuthoring } from "./material-video-authoring.client";

const materialId = "02000000-0000-4000-8000-000000000010";
const oldUpload = {
  origin: "platform_upload",
  protected: true,
  state: "ready",
  title: "Прежнее видео",
  videoId: "03000000-0000-4000-8000-000000000001",
} as const;
const selected = {
  ...oldUpload,
  title: "Выбранное видео",
  videoId: "03000000-0000-4000-8000-000000000002",
};
const attached = {
  ...oldUpload,
  title: "Новое видео",
  videoId: "03000000-0000-4000-8000-000000000003",
  access: "closed",
  materialId,
} as const;
const environment = authoringPageEnvironment(
  `/authoring/materials/${materialId}`,
);
function spyFetch() {
  return spyOn(window, "fetch");
}
let request: ReturnType<typeof spyFetch>;
let answer: ReturnType<typeof Promise.withResolvers<Response>>;
const meta = {
  ...environment,
  title: "Patterns/Authoring/Video lifetime",
  component: MaterialVideoAuthoring,
  beforeEach: () => {
    environment.beforeEach();
    answer = Promise.withResolvers<Response>();
    request = spyFetch().mockImplementation((input) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      ).pathname;
      if (path !== "/api/authoring/material-video-attachments")
        throw new Error(`Unexpected video request: ${path}`);
      return answer.promise;
    });
    return () => {
      answer.resolve(new Response(null, { status: 503 }));
      request.mockRestore();
    };
  },
  args: {
    access: "closed",
    materialId,
    deleteVideoId: null,
    disabled: false,
    latestVideoDeletion: null,
    primaryVideo: oldUpload,
    unselectedUpload: null,
    onChange: fn(),
  },
} satisfies Meta<typeof MaterialVideoAuthoring>;
export default meta;
type Story = StoryObj<typeof meta>;

function ChangeSelection(args: Parameters<typeof MaterialVideoAuthoring>[0]) {
  const [primaryVideo, setPrimaryVideo] = useState(args.primaryVideo);
  return (
    <>
      <button
        onClick={() => {
          setPrimaryVideo(selected);
        }}
      >
        Выбрать другое видео
      </button>
      <MaterialVideoAuthoring {...args} primaryVideo={primaryVideo} />
    </>
  );
}
async function startAttachment(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(
    canvas.getByText("Выбрать существующее видео Kinescope"),
  );
  await userEvent.type(
    canvas.getByLabelText(/ID видео/u),
    "provider-recording",
  );
  await userEvent.click(canvas.getByRole("button", { name: "Привязать" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
}
export const SelectionChangesDuringAttachment: Story = {
  render: (args) => <ChangeSelection {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await startAttachment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Выбрать другое видео" }),
    );
    answer.resolve(Response.json({ kind: "ready", value: attached }));
    await waitFor(() => expect(args.onChange).toHaveBeenCalledTimes(2));
    await expect(args.onChange).toHaveBeenNthCalledWith(
      1,
      selected,
      null,
      "03000000-0000-4000-8000-000000000001",
    );
    await expect(args.onChange).toHaveBeenNthCalledWith(
      2,
      attached,
      null,
      null,
    );
    await expect(
      canvas.getByText("Новое видео", { exact: true }),
    ).toBeVisible();
  },
};
export const HiddenAttachmentCannotSelect: Story = {
  render: (args) => (
    <AutosaveActivity>
      <MaterialVideoAuthoring {...args} />
    </AutosaveActivity>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await startAttachment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть Activity" }),
    );
    answer.resolve(Response.json({ kind: "ready", value: attached }));
    await answer.promise;
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть Activity" }),
    );
    await expect(canvas.queryByText("Новое видео", { exact: true })).toBeNull();
    await expect(args.onChange).not.toHaveBeenCalled();
    await expect(
      canvas.getByText("Прежнее видео", { exact: true }),
    ).toBeVisible();
  },
};
