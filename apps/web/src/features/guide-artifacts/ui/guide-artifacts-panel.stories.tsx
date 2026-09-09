import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";

import { withMutationFetch } from "@/workshop/mutation-mock";
import type { GuideArtifact } from "../model/guide-artifacts";
import { GuideArtifactsPanel } from "./guide-artifacts-panel.client";

const guideId = "97000000-0000-4000-8000-000000000003";
const otherGuideId = "97000000-0000-4000-8000-000000000004";

const fileArtifact: GuideArtifact = {
  access: "membership",
  archived: false,
  artifactId: "97000000-0000-4000-8000-000000000101",
  content: {
    contentType: "text/markdown",
    filename: "release-checklist.md",
    kind: "file",
    size: 4096,
  },
  guideIds: [guideId, otherGuideId],
  materialIds: [],
  origin: "platform",
  purpose: "Пройтись по пунктам перед первым релизом.",
  sourceId: null,
  title: "Чек-лист выпуска",
  updatedAt: "2026-09-09T10:00:00.000Z",
  version: 2,
};

const linkArtifact: GuideArtifact = {
  access: "free",
  archived: false,
  artifactId: "97000000-0000-4000-8000-000000000102",
  content: { externalUrl: "https://example.test/board", kind: "link" },
  guideIds: [guideId],
  materialIds: [],
  origin: "authoring",
  purpose: "Доска с примером процесса.",
  sourceId: "authored/board",
  title: "Шаблон доски",
  updatedAt: "2026-09-08T09:00:00.000Z",
  version: 1,
};

const archivedArtifact: GuideArtifact = {
  ...fileArtifact,
  archived: true,
  artifactId: "97000000-0000-4000-8000-000000000103",
  guideIds: [guideId],
  title: "Старый шаблон отчёта",
};

function Fixture({
  artifacts,
  children,
  failing = false,
}: {
  readonly artifacts: readonly GuideArtifact[];
  readonly children: ReactNode;
  readonly failing?: boolean;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      ["guide-artifacts", guideId],
      failing ? { kind: "error", reference: "guide-artifacts-response" } : { artifacts, kind: "ready" },
    );
    queryClient.setQueryData(["guide-artifacts", "reusable"], {
      artifacts: [
        { ...linkArtifact, artifactId: "97000000-0000-4000-8000-000000000104", guideIds: [otherGuideId], title: "Схема окружения" },
      ],
      kind: "ready",
    });
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const meta = {
  args: { archived: false, guideId },
  component: GuideArtifactsPanel,
  decorators: [
    (Story) => (
      <Fixture artifacts={[fileArtifact, linkArtifact]}>
        <Story />
      </Fixture>
    ),
  ],
  parameters: { layout: "padded" },
  title: "Components/Guide artifacts",
} satisfies Meta<typeof GuideArtifactsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Чек-лист выпуска")).toBeVisible();
    await expect(
      canvas.getByText("release-checklist.md · 4.0 КБ"),
    ).toBeVisible();
    await expect(canvas.getByText(/ещё в 1 руководстве/u)).toBeVisible();
    await expect(canvas.getByText("https://example.test/board")).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Empty: Story = {
  decorators: [
    (Story) => (
      <Fixture artifacts={[]}>
        <Story />
      </Fixture>
    ),
  ],
};

export const Archived: Story = {
  decorators: [
    (Story) => (
      <Fixture artifacts={[archivedArtifact]}>
        <Story />
      </Fixture>
    ),
  ],
};

export const ArchivedGuide: Story = {
  args: { archived: true, guideId },
};

export const LoadError: Story = {
  decorators: [
    (Story) => (
      <Fixture artifacts={[]} failing>
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("alert"),
    ).toHaveTextContent("Не удалось загрузить артефакты.");
  },
};

export const StillReferenced: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({ guideIds: [guideId, otherGuideId], kind: "referenced" }),
      ),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [remove] = canvas.getAllByRole("button", { name: /Удалить совсем/u });
    if (remove === undefined) throw new Error("Expected a removal action");
    await userEvent.click(remove);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Артефакт ещё используется в 2 руководствах.",
    );
  },
};

export const AddLinkForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Добавить ссылку" }));
    await expect(
      canvas.getByRole("form", { name: "Новый артефакт по ссылке" }),
    ).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Название" })).toBeVisible();
  },
};
