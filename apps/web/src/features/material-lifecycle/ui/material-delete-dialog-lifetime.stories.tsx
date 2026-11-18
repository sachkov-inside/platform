import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { authoringPageEnvironment } from "@/storybook/story-environment";

import type { DeleteMaterialDraftInput } from "../model/delete-material-draft";
import { MaterialDeleteDialog } from "./material-delete-dialog.client";

function RetainedDraftDeletion() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [payload, setPayload] = useState<DeleteMaterialDraftInput | null>(null);
  const [closes, setCloses] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуть редактор
      </button>
      <output aria-label="Подтверждение">{JSON.stringify(payload)}</output>
      <output aria-label="Закрытия диалога">{closes}</output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <MaterialDeleteDialog
            contentVersion={7}
            materialId="02000000-0000-4000-8000-000000000001"
            submissionId="02000000-0000-4000-8000-000000000002"
            pending={false}
            result={null}
            title="Синтетический черновик"
            primaryVideo={{
              origin: "platform_upload",
              title: "Синтетическое видео",
              videoId: "02000000-0000-4000-8000-000000000003",
            }}
            onOpenChange={() => {
              setCloses((count) => count + 1);
            }}
            onDelete={(input) => {
              setPayload(input);
              if (payload === null) setVisible(false);
              else setMounted(false);
            }}
          />
        ) : null}
      </Activity>
    </>
  );
}

function ControlledDraftDeletion({
  pending = false,
}: {
  readonly pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Открыть подтверждение
      </button>
      <output aria-label="Закрытия диалога">{closes}</output>
      <MaterialDeleteDialog
        contentVersion={7}
        materialId="02000000-0000-4000-8000-000000000001"
        submissionId="02000000-0000-4000-8000-000000000002"
        pending={pending}
        result={null}
        title="Контролируемый черновик"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCloses((count) => count + 1);
        }}
        onDelete={() => {
          setOpen(false);
        }}
        primaryVideo={{
          origin: "external_attachment",
          title: "Внешнее видео",
          videoId: "02000000-0000-4000-8000-000000000003",
        }}
      />
    </>
  );
}

const meta = {
  ...authoringPageEnvironment(authoringMaterialsRootHref),
  title: "Patterns/Draft deletion lifetime",
  component: RetainedDraftDeletion,
} satisfies Meta<typeof RetainedDraftDeletion>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HiddenEditorReleasesModalAndRetainsChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить черновик" }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: "Удалить «Синтетический черновик»?",
    });
    const checkbox = within(dialog).getByRole("checkbox");
    await expect(dialog.matches(":modal")).toBe(true);
    await userEvent.click(checkbox);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Удалить безвозвратно" }),
    );
    await waitFor(() => expect(dialog).not.toBeVisible());
    await expect(dialog.isConnected).toBe(true);
    await expect(dialog.matches(":modal")).toBe(false);
    await expect(
      canvas.getByRole("status", { name: "Подтверждение" }),
    ).toHaveTextContent(
      JSON.stringify({
        deleteVideoId: "02000000-0000-4000-8000-000000000003",
        expectedContentVersion: 7,
        materialId: "02000000-0000-4000-8000-000000000001",
        submissionId: "02000000-0000-4000-8000-000000000002",
      }),
    );
    await expect(
      canvas.getByRole("status", { name: "Закрытия диалога" }),
    ).toHaveTextContent("0");
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть редактор" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(canvas.getByRole("dialog")).toBe(dialog);
    await expect(checkbox).toBeChecked();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Оставить черновик" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await waitFor(() =>
      expect(
        canvas.getByRole("status", { name: "Закрытия диалога" }),
      ).toHaveTextContent("1"),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить черновик" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(checkbox).not.toBeChecked();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Удалить безвозвратно" }),
    );
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expect(dialog.matches(":modal")).toBe(false);
    await expect(
      canvas.getByRole("status", { name: "Подтверждение" }),
    ).toHaveTextContent(
      JSON.stringify({
        deleteVideoId: null,
        expectedContentVersion: 7,
        materialId: "02000000-0000-4000-8000-000000000001",
        submissionId: "02000000-0000-4000-8000-000000000002",
      }),
    );
  },
};

export const ControlledCloseReportsOnce: Story = {
  render: () => <ControlledDraftDeletion />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть подтверждение" }),
    );
    const dialog = await canvas.findByRole("dialog");
    await expect(within(dialog).queryByRole("checkbox")).toBeNull();
    await expect(
      within(dialog).getByText(/останется в Kinescope/u),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Удалить безвозвратно" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await waitFor(() =>
      expect(
        canvas.getByRole("status", { name: "Закрытия диалога" }),
      ).toHaveTextContent("1"),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть подтверждение" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Оставить черновик" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await waitFor(() =>
      expect(
        canvas.getByRole("status", { name: "Закрытия диалога" }),
      ).toHaveTextContent("2"),
    );
  },
};

export const PendingKeepsNativeCancelPolicy: Story = {
  render: () => <ControlledDraftDeletion pending />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть подтверждение" }),
    );
    const dialog = await canvas.findByRole("dialog");
    await expect(
      within(dialog).getByRole("button", { name: "Удаляем…" }),
    ).toBeDisabled();
    await expect(
      within(dialog).getByRole("button", { name: "Оставить черновик" }),
    ).toBeDisabled();
    // Named untrusted platform input tests the cancel handler; trusted Escape is a route check.
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(dialog.matches(":modal")).toBe(false));
    await waitFor(() =>
      expect(
        canvas.getByRole("status", { name: "Закрытия диалога" }),
      ).toHaveTextContent("1"),
    );
  },
};
