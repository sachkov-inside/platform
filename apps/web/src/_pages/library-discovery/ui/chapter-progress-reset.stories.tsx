import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { z } from "zod";

import type { MaterialPreview } from "@/entities/material";
import type { PublishedProductResult } from "@/features/library-discovery";
import { ReadingProgressProvider } from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import {
  ChapterProgressResetView,
  type ChapterProgressResetState,
} from "./chapter-progress-reset.client";
import { ProductLearningProvider } from "./product-learning.client";
import { ProductProgrammeView } from "./product-programme-view";

const accountId = "45000000-0000-4000-8000-000000000001";
const lessonIds = Array.from(
  { length: 6 },
  (_, index) => `44000000-0000-4000-8000-00000000000${String(index + 1)}`,
);
const materials = lessonIds.map((materialId, index): MaterialPreview => ({
  materialId,
  slug: `chapter-reset-lesson-${String(index + 1)}`,
  title: `Урок ${String(index + 1)}. Стек и запуск учебного проекта`,
  summary: "",
  access: "free",
  availability: "available",
  format: index % 2 === 0 ? "Видео" : "Текст",
  formatSlug: index % 2 === 0 ? "video" : "text",
  topic: "Учебный проект",
  topicSlug: "chapter-reset",
  tags: [],
  productMemberships: [
    { name: "Сброс главы", slug: "chapter-reset", ordinal: index + 1 },
  ],
}));
const result = {
  kind: "ready",
  discoveryKind: "product",
  hasNext: false,
  reference: { name: "Сброс главы", slug: "chapter-reset", summary: "" },
  chapters: [
    {
      id: "46000000-0000-4000-8000-000000000001",
      name: "Учебный проект",
      summary: "",
      materialIds: lessonIds,
    },
  ],
  items: materials,
  relatedProduct: [],
  topics: [],
} satisfies PublishedProductResult;
const environment = publicPageEnvironment("/products/chapter-reset/programme", {
  account: "authenticated",
});

let client: QueryClient;
const studied = new Set<string>();
const resets: { materialIds: string[]; commandId: string }[] = [];
let failNextReset = false;

function ChapterWindow() {
  return (
    <QueryClientProvider client={client}>
      <ReadingProgressProvider accountId={accountId} resolved>
        <ProductLearningProvider
          learning={{ kind: "ready", read: 4, total: 6, continuation: null }}
        >
          <ProductProgrammeView result={result} productOpen />
        </ProductLearningProvider>
      </ReadingProgressProvider>
    </QueryClientProvider>
  );
}

const meta = {
  ...environment,
  title: "Pages/Product/Chapter progress reset",
  component: ChapterWindow,
  beforeEach: () => {
    const restoreEnvironment = environment.beforeEach();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    studied.clear();
    for (const id of lessonIds.slice(0, 4)) studied.add(id);
    resets.length = 0;
    failNextReset = false;
    const restoreFetch = fetchBeforeRender(async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), window.location.origin), init);
      const path = new URL(request.url).pathname;
      if (path === "/api/reading-progress/states") {
        const { materialIds } = z
          .strictObject({ materialIds: z.array(z.uuid()).min(1).max(100) })
          .parse(await request.json());
        return Response.json({
          kind: "ready",
          states: materialIds.map((materialId) => ({
            materialId,
            isRead: studied.has(materialId),
            version: studied.has(materialId) ? 1 : 2,
            readAt: null,
            updatedAt: null,
            updateNote: null,
            openedParts: null,
          })),
        });
      }
      if (path === "/api/reading-progress/reset") {
        const command = z
          .strictObject({
            materialIds: z.array(z.uuid()),
            commandId: z.uuid(),
          })
          .parse(await request.json());
        resets.push(command);
        if (failNextReset) {
          failNextReset = false;
          return Response.json({ kind: "unavailable" });
        }
        const resetCount = command.materialIds.filter((id) =>
          studied.delete(id),
        ).length;
        return Response.json({ kind: "reset", resetCount });
      }
      throw new Error(
        `Unexpected chapter reset request: ${request.method} ${path}`,
      );
    })();
    return () => {
      restoreFetch();
      client.clear();
      restoreEnvironment?.();
    };
  },
} satisfies Meta<typeof ChapterWindow>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openWindow(canvasElement: HTMLElement) {
  const tile = await waitFor(() => {
    const found = canvasElement.querySelector<HTMLElement>(
      "[data-chapter-tile]",
    );
    if (found === null) throw new Error("Missing chapter tile");
    return found;
  });
  await userEvent.click(tile);
  return waitFor(() => {
    const dialog = canvasElement.ownerDocument.querySelector<HTMLElement>(
      "dialog[data-chapter-window][open]",
    );
    if (dialog === null) throw new Error("Chapter window is closed");
    return dialog;
  });
}

/** The reset waits for a confirmation in place, then the chapter starts over everywhere. */
export const ResetsAfterConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await openWindow(canvasElement));
    await dialog.findByText("Изучено 4 из 6");
    await userEvent.click(
      await dialog.findByRole("button", { name: "Сбросить прогресс главы" }),
    );
    await expect(
      dialog.getByText(
        "Снять отметку «изучено» с 4 уроков и начать главу заново?",
      ),
    ).toBeVisible();
    // Focus waits on «Отмена», so a second Enter never resets by accident.
    await expect(dialog.getByRole("button", { name: "Отмена" })).toHaveFocus();
    await userEvent.click(dialog.getByRole("button", { name: "Отмена" }));
    await expect(
      dialog.getByRole("button", { name: "Сбросить прогресс главы" }),
    ).toHaveFocus();
    await expect(resets).toHaveLength(0);

    await userEvent.click(
      dialog.getByRole("button", { name: "Сбросить прогресс главы" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Сбросить" }));
    await expect(
      await dialog.findByRole("status", { name: "" }),
    ).toHaveTextContent("Прогресс главы сброшен");
    await expect(resets.map((reset) => reset.materialIds)).toEqual([lessonIds]);
    await dialog.findByText("Изучено 0 из 6");
  },
};

/** A failed reset keeps the question open; a retry repeats the same command. */
export const RetriesTheSameCommand: Story = {
  play: async ({ canvasElement }) => {
    failNextReset = true;
    const dialog = within(await openWindow(canvasElement));
    await userEvent.click(
      await dialog.findByRole("button", { name: "Сбросить прогресс главы" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Сбросить" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Не получилось сбросить прогресс",
    );
    await userEvent.click(dialog.getByRole("button", { name: "Повторить" }));
    await dialog.findByText("Изучено 0 из 6");
    await expect(resets).toHaveLength(2);
    await expect(resets[1]?.commandId).toBe(resets[0]?.commandId);
  },
};

export const ResetsAfterConfirmationMobile: Story = {
  ...ResetsAfterConfirmation,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** A chapter without studied lessons offers nothing to reset. */
export const NothingToReset: Story = {
  beforeEach: () => {
    studied.clear();
  },
  play: async ({ canvasElement }) => {
    const dialog = within(await openWindow(canvasElement));
    await dialog.findByText("Изучено 0 из 6");
    await expect(
      dialog.queryByRole("button", { name: "Сбросить прогресс главы" }),
    ).not.toBeInTheDocument();
  },
};

function Steps() {
  const states: readonly ChapterProgressResetState[] = [
    { kind: "offer" },
    { kind: "confirm", status: "idle" },
    { kind: "confirm", status: "pending" },
    { kind: "confirm", status: "failed" },
    { kind: "done" },
  ];
  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: "36rem" }}>
      {states.map((state) => (
        <ChapterProgressResetView
          key={JSON.stringify(state)}
          onCancel={() => undefined}
          onConfirm={() => undefined}
          onOffer={() => undefined}
          read={9}
          state={state}
        />
      ))}
    </div>
  );
}

/** Every step of the reset side by side: offer, question, saving, failure, result. */
export const AllSteps: Story = { render: () => <Steps /> };

/**
 * Prototype of the owner's choice (24.11.2026): the reset at the end of the lessons (chosen and
 * shipped) and the rejected alternative in the middle of the pager.
 */
function PlacementPrototype({ placement }: { placement: "list" | "pager" }) {
  const [state, setState] = useState<ChapterProgressResetState>({
    kind: "offer",
  });
  const control = (
    <ChapterProgressResetView
      onCancel={() => {
        setState({ kind: "offer" });
      }}
      onConfirm={() => {
        setState({ kind: "done" });
      }}
      onOffer={() => {
        setState({ kind: "confirm", status: "idle" });
      }}
      read={9}
      state={state}
    />
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "min(40rem, 100%)",
        height: "40rem",
        margin: "0 auto",
        overflow: "hidden",
        borderRadius: "var(--radius-2xl)",
        background: "var(--card)",
        boxShadow: "var(--elevation-cover)",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: "0.75rem",
          flex: 1,
          overflowY: "auto",
          padding: "1.25rem 1.5rem",
        }}
      >
        {materials.map((material, index) => (
          <div
            key={material.materialId}
            style={{
              borderRadius: "var(--radius-xl)",
              background: "var(--secondary)",
              padding: "1rem 1.25rem",
            }}
          >
            <strong>{String(index + 1)}</strong> {material.title}
          </div>
        ))}
        {placement === "list" ? control : null}
      </div>
      {/* The pager is too narrow for the question: it opens as a strip above it. */}
      {placement === "pager" && state.kind !== "offer" ? (
        <div style={{ padding: "0 1.5rem 1rem" }}>{control}</div>
      ) : null}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          borderTop: "1px solid var(--border)",
          padding: "0.5rem 0.75rem",
        }}
      >
        <span>← Предыдущая</span>
        {placement === "pager" ? (
          <Button
            disabled={state.kind !== "offer"}
            onClick={() => {
              setState({ kind: "confirm", status: "idle" });
            }}
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" />
            Сбросить прогресс
          </Button>
        ) : null}
        <span>Следующая →</span>
      </nav>
    </div>
  );
}

export const PrototypeAtListEnd: Story = {
  render: () => <PlacementPrototype placement="list" />,
};
export const PrototypeInPager: Story = {
  render: () => <PlacementPrototype placement="pager" />,
};
