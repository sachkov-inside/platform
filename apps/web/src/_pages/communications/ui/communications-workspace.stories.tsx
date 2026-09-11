import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, fn, userEvent, within } from "storybook/test";
import { useState } from "react";
import type { Funnel, Part, Preview } from "../model/communications";
import {
  CommunicationsWorkspace,
  type CommunicationsActions,
} from "./communications-workspace.client";
import { authoringPageEnvironment } from "@/workshop/story-environment";

const id = "30800000-0000-4000-8000-000000000001";
const part: Part = {
  partId: "30800000-0000-4000-8000-000000000002",
  content: {
    type: "text",
    text: "Тестовый пример: начните с бесплатного материала Inside.",
    entities: [],
    buttons: [],
  },
};
const funnel: Funnel = {
  funnelId: id,
  name: "Знакомство с Inside",
  revision: 3,
  publishedRevision: 2,
  lifecycle: "published",
  isDefault: true,
  entryResponse: {
    stepId: "30800000-0000-4000-8000-000000000003",
    parts: [part],
  },
  steps: [
    {
      stepId: "30800000-0000-4000-8000-000000000004",
      delaySeconds: 86400,
      parts: [{ ...part, partId: "30800000-0000-4000-8000-000000000005" }],
    },
  ],
  sources: [
    {
      sourceId: "30800000-0000-4000-8000-000000000006",
      code: "m_demo",
      name: "Тестовый ролик",
    },
  ],
};
const preview: Preview = {
  funnelId: id,
  revision: 3,
  addedStepIds: ["30800000-0000-4000-8000-000000000004"],
  editedStepIds: [],
  deletedStepIds: [],
  reorderedStepIds: [],
  eligibleContacts: 12,
  completedParticipantsReceivingNewSteps: 7,
  validationErrors: [],
  targetErrors: [],
};
const actions: CommunicationsActions = {
  readSavedPosts: fn<CommunicationsActions["readSavedPosts"]>(() =>
    Promise.resolve({
      kind: "ready",
      templates: [
        {
          templateId: id,
          revision: 1,
          content: {
            type: "video_note",
            text: "",
            entities: [],
            buttons: [],
            fileId: "synthetic_file",
          },
        },
      ],
      nextCursor: null,
    }),
  ),
  savePost: fn<CommunicationsActions["savePost"]>((input) =>
    Promise.resolve({
      kind: "ready",
      template: {
        templateId: input.payload.templateId,
        revision: input.expectedRevision + 1,
        content: input.payload.content,
      },
    }),
  ),
  samplePost: fn<CommunicationsActions["samplePost"]>(() =>
    Promise.resolve({ kind: "ready", testDeliveryId: id }),
  ),
  listFunnels: fn<CommunicationsActions["listFunnels"]>(() =>
    Promise.resolve({
      kind: "ready",
      value: {
        funnels: [funnel],
        nextCursor: null,
        botStartUrl: "https://t.me/inside_synthetic_bot",
      },
    }),
  ),
  readFunnel: fn<CommunicationsActions["readFunnel"]>(() =>
    Promise.resolve({ kind: "ready", value: funnel }),
  ),
  saveFunnel: fn<CommunicationsActions["saveFunnel"]>((input) =>
    Promise.resolve({
      kind: "ready",
      value: {
        ...input.draft,
        revision: input.expectedRevision + 1,
        publishedRevision: null,
        lifecycle: "draft",
      },
    }),
  ),
  previewFunnel: fn<CommunicationsActions["previewFunnel"]>(() =>
    Promise.resolve({ kind: "ready", value: preview }),
  ),
  publishFunnel: fn<CommunicationsActions["publishFunnel"]>(() =>
    Promise.resolve({
      kind: "ready",
      value: { ...funnel, revision: 4, publishedRevision: 4 },
    }),
  ),
  changeFunnelLifecycle: fn<CommunicationsActions["changeFunnelLifecycle"]>(
    () =>
      Promise.resolve({
        kind: "ready",
        value: { ...funnel, revision: 4, lifecycle: "paused" },
      }),
  ),
  readIntro: fn<CommunicationsActions["readIntro"]>(() =>
    Promise.resolve({
      kind: "ready",
      value: { introId: id, revision: 1, parts: [part] },
    }),
  ),
  saveIntro: fn<CommunicationsActions["saveIntro"]>((input) =>
    Promise.resolve({
      kind: "ready",
      value: {
        introId: input.introId,
        revision: input.expectedRevision + 1,
        parts: input.parts,
      },
    }),
  ),
  readDeliveries: fn<CommunicationsActions["readDeliveries"]>(() =>
    Promise.resolve({
      kind: "ready",
      value: { deliveries: [], nextCursor: null },
    }),
  ),
  skipDelivery: fn<CommunicationsActions["skipDelivery"]>((input) =>
    Promise.resolve({
      kind: "ready",
      value: {
        deliveryId: input.deliveryId,
        partId: input.partId,
        outcome: "skipped",
      },
    }),
  ),
  retryDelivery: fn<CommunicationsActions["retryDelivery"]>((input) =>
    Promise.resolve({
      kind: "ready",
      value: {
        deliveryId: input.deliveryId,
        partId: input.partId,
        outcome: "retry_requested",
      },
    }),
  ),
  resolveTemplate: fn<CommunicationsActions["resolveTemplate"]>(() =>
    Promise.resolve({
      kind: "ready",
      value: {
        templateId: id,
        revision: 1,
        content: {
          type: "video_note",
          text: "",
          entities: [],
          buttons: [],
          fileId: "synthetic_file",
        },
      },
    }),
  ),
};
function QueryFixture({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const environment = authoringPageEnvironment("/authoring/communications");
const meta = {
  title: "Pages/Authoring/Воронки Telegram",
  component: CommunicationsWorkspace,
  args: { actions },
  ...environment,
  decorators: [
    (Story) => (
      <QueryFixture>
        <Story />
      </QueryFixture>
    ),
    ...environment.decorators,
  ],
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Редактор воронок использует тот же компонент и AuthoringShell, что и /authoring/communications. Сохранение черновика, проверка охвата и публикация — отдельные действия. Все данные здесь синтетические; сообщения не отправляются. Визуальное принятие: #316.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CommunicationsWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
async function openFunnel(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(
    await canvas.findByRole("button", { name: "Открыть Знакомство с Inside" }),
  );
  return canvas;
}
export const Existing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Отложенные шаги" }),
    ).toBeVisible();
  },
};
export const Empty: Story = {
  args: {
    actions: {
      ...actions,
      listFunnels: fn<CommunicationsActions["listFunnels"]>(() =>
        Promise.resolve({
          kind: "ready",
          value: {
            funnels: [],
            nextCursor: null,
            botStartUrl: "https://t.me/inside_synthetic_bot",
          },
        }),
      ),
    },
  },
};
export const Loading: Story = {
  args: {
    actions: {
      ...actions,
      listFunnels: () =>
        new Promise(() => {
          /* Loading fixture intentionally never settles. */
        }),
    },
  },
};
export const NoAccess: Story = {
  args: {
    actions: {
      ...actions,
      listFunnels: fn<CommunicationsActions["listFunnels"]>(() =>
        Promise.resolve({ kind: "error", code: "forbidden" }),
      ),
    },
  },
};
export const Conflict: Story = {
  args: {
    actions: {
      ...actions,
      saveFunnel: fn<CommunicationsActions["saveFunnel"]>(() =>
        Promise.resolve({ kind: "error", code: "conflict" }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    const name = canvas.getByLabelText("Название воронки");
    await userEvent.clear(name);
    await userEvent.type(name, "Мои сохранённые на экране правки");
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить черновик" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Ваши правки сохранены на экране",
    );
    await expect(name).toHaveValue("Мои сохранённые на экране правки");
  },
};
export const PublishPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Проверить изменения и охват" }),
    );
    await expect(await canvas.findByText("Ожидаемый охват: 12")).toBeVisible();
    await expect(
      canvas.getByText("Завершили воронку и получат новые шаги: 7"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Опубликовать воронку" }),
    ).toBeEnabled();
  },
};
export const UnpublishedTarget: Story = {
  args: {
    actions: {
      ...actions,
      previewFunnel: fn<CommunicationsActions["previewFunnel"]>(() =>
        Promise.resolve({
          kind: "ready",
          value: {
            ...preview,
            targetErrors: [
              {
                url: "https://inside.example/materials/test",
                reason: "not_published",
                targetId: id,
              },
            ],
          },
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Проверить изменения и охват" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "снят с публикации",
    );
    await expect(
      canvas.queryByRole("button", { name: "Опубликовать воронку" }),
    ).not.toBeInTheDocument();
  },
};
export const MultipartMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    const editor = within(
      canvas.getByRole("region", { name: "Редактор воронки" }),
    );
    const button = editor.getAllByRole("button", {
      name: "Добавить сохранённый пост",
    })[0];
    if (!button) throw new Error("Missing post picker");
    await userEvent.click(button);
    await userEvent.click(
      await canvas.findByRole("button", { name: /Кружок · v1/ }),
    );
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Добавить в последовательность",
      }),
    );
    await expect(await canvas.findByText("Часть 2 · Кружок")).toBeVisible();
  },
};
export const UnknownDelivery: Story = {
  args: {
    actions: {
      ...actions,
      readDeliveries: fn<CommunicationsActions["readDeliveries"]>(() =>
        Promise.resolve({
          kind: "ready",
          value: {
            nextCursor: null,
            deliveries: [
              {
                deliveryId: id,
                revision: 2,
                contactId: id,
                stepId: "30800000-0000-4000-8000-000000000004",
                publishedRevision: 2,
                snapshot: [part],
                cancelRequested: false,
                completedAt: null,
                parts: [
                  {
                    partId: part.partId,
                    state: "unknown",
                    diagnosticCode: "transport_unknown",
                    attempts: [
                      {
                        attemptId: id,
                        attemptedAt: "2030-01-01T00:00:00Z",
                        outcome: "unknown",
                        diagnosticCode: "transport_unknown",
                        duplicateRiskAccepted: false,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    const retry = await canvas.findByRole("button", {
      name: "Повторить часть 1",
    });
    await expect(retry).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("checkbox", {
        name: "Я понимаю, что повторная отправка может создать дубль",
      }),
    );
    await expect(retry).toBeEnabled();
  },
};

export const LoadError: Story = {
  args: {
    actions: {
      ...actions,
      listFunnels: fn<CommunicationsActions["listFunnels"]>(() =>
        Promise.resolve({ kind: "error", code: "unavailable" }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Не удалось открыть воронки",
    );
    await expect(
      canvas.getByRole("button", { name: "Повторить загрузку" }),
    ).toBeEnabled();
  },
};
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    await userEvent.click(canvas.getByLabelText("Название воронки"));
    await userEvent.tab();
    await expect(
      canvas.getByRole("checkbox", {
        name: "Стандартная воронка для обычного запуска бота",
      }),
    ).toHaveFocus();
  },
};
export const NarrowMobile: Story = {
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await openFunnel(canvasElement);
  },
};
export const Dark: Story = {
  globals: { theme: "dark" },
  play: async ({ canvasElement }) => {
    await openFunnel(canvasElement);
  },
};

export const SavedPostPagination: Story = {
  args: {
    actions: {
      ...actions,
      saveIntro: fn<CommunicationsActions["saveIntro"]>(actions.saveIntro),
      saveFunnel: fn<CommunicationsActions["saveFunnel"]>(actions.saveFunnel),
      readSavedPosts: fn<CommunicationsActions["readSavedPosts"]>((cursor) =>
        Promise.resolve({
          kind: "ready",
          templates: [{ templateId: id, revision: 1, content: part.content }],
          nextCursor: cursor ? null : "next-page",
        }),
      ),
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = await openFunnel(canvasElement);
    await userEvent.click(
      canvas.getByText("Общее знакомство · один раз на человека"),
    );
    for (const name of [
      "Части общего знакомства",
      "Непосредственный ответ по ссылке",
    ]) {
      const group = within(canvas.getByRole("group", { name }));
      await userEvent.click(
        group.getByRole("button", { name: "Добавить сохранённый пост" }),
      );
      await userEvent.click(
        group.getByRole("button", { name: "Обновить посты" }),
      );
      await userEvent.click(
        await group.findByRole("button", { name: "Следующие посты" }),
      );
      await expect(args.actions.readSavedPosts).toHaveBeenCalledWith(
        "next-page",
      );
      await expect(args.actions.saveIntro).not.toHaveBeenCalled();
      await expect(args.actions.saveFunnel).not.toHaveBeenCalled();
      await userEvent.click(
        group.getByRole("button", { name: "Закрыть выбор" }),
      );
    }
  },
};

export const SwitchFunnelWhileChoosing: Story = {
  args: {
    actions: {
      ...actions,
      listFunnels: fn<CommunicationsActions["listFunnels"]>(() =>
        Promise.resolve({
          kind: "ready",
          value: {
            funnels: [
              funnel,
              {
                ...funnel,
                funnelId: "30800000-0000-4000-8000-000000000020",
                name: "Другая воронка",
                entryResponse: {
                  stepId: "30800000-0000-4000-8000-000000000021",
                  parts: [
                    { ...part, partId: "30800000-0000-4000-8000-000000000022" },
                  ],
                },
              },
            ],
            nextCursor: null,
            botStartUrl: "https://t.me/inside_synthetic_bot",
          },
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await openFunnel(canvasElement);
    const group = within(
      canvas.getByRole("group", { name: "Непосредственный ответ по ссылке" }),
    );
    await userEvent.click(
      group.getByRole("button", {
        name: "Заменить часть 1 из сохранённых постов",
      }),
    );
    await expect(group.getByText("Замена выбранной части")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть Другая воронка" }),
    );
    await expect(
      canvas.queryByText("Замена выбранной части"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Название воронки")).toHaveValue(
      "Другая воронка",
    );
    await expect(
      canvas.getByRole("button", { name: "Отменить несохранённые правки" }),
    ).toBeDisabled();
  },
};
