import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { getQueryClient } from "@/shared/api/query-client";
import { ProductAccessPanel } from "./product-access-panel.client";
const accountId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000f01";
const record = {
  accountId,
  productId,
  firstIssuedAt: "2026-10-23T10:00:00Z",
  revision: 2,
  access: "revoked" as const,
};
function replies(firstIssuedAt: string | null = record.firstIssuedAt) {
  getQueryClient().clear();
  let restored = false;
  return fetchBeforeRender((input) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    ).pathname;
    const value = {
      ...record,
      firstIssuedAt,
      access: restored ? "active" : "revoked",
      revision: restored ? 3 : 2,
    };
    if (path.endsWith("content/list"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            operationRef: accountId,
            result: {
              outcome: "content",
              items: [
                {
                  kind: "product",
                  id: productId,
                  title: "Проверочный продукт",
                  slug: "platform-inside",
                  available: true,
                },
              ],
            },
          },
        }),
      );
    if (path.endsWith("/list"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: { ok: true, value: [value], nextCursor: null },
        }),
      );
    if (path.endsWith("/read"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ok: true,
            value: {
              ...value,
              sources: [
                {
                  source: "manual",
                  sourceRef: "owner-issue-1709",
                  issuedAt: record.firstIssuedAt,
                  reason: "Обучение команды",
                },
              ],
              actions: [
                {
                  id: "30000000-0000-4000-8000-000000000001",
                  kind: "revoked",
                  actorId: accountId,
                  reason: "Отзыв владельцем",
                  recordedAt: "2026-10-24T10:00:00Z",
                  revision: 2,
                },
              ],
            },
          },
        }),
      );
    if (path.endsWith("/restore")) {
      restored = true;
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ok: true,
            value: { ...value, access: "active", revision: 3 },
          },
        }),
      );
    }
    if (path.endsWith("content/list"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            operationRef: accountId,
            result: { outcome: "content", items: [] },
          },
        }),
      );
    return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
  })();
}
const environment = authoringPageEnvironment("/authoring/access");
const meta = {
  ...environment,
  title: "Components/Authoring/Product access",
  component: ProductAccessPanel,
  beforeEach: [environment.beforeEach, () => replies()],
} satisfies Meta<typeof ProductAccessPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const ExplicitRestore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать права" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "История права" }),
    );
    await expect(
      await canvas.findByText("Обучение команды", { exact: false }),
    ).toBeVisible();
    await userEvent.type(
      canvas.getByLabelText("Причина восстановления"),
      "Решение владельца",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Явно восстановить доступ" }),
    );
    await expect(
      await canvas.findByText("Доступ явно восстановлен владельцем."),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Явно восстановить доступ" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText(/^Доступ отозван · первая выдача/u),
    ).not.toBeInTheDocument();
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const UnknownHistoricalIssuance: Story = {
  beforeEach: [environment.beforeEach, () => replies(null)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать права" }),
    );
    await expect(
      await canvas.findByText("Доступ отозван · первая выдача дата неизвестна"),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "История права" }),
    );
    await expect(
      await canvas.findByText("Доступ отозван. Первая выдача дата неизвестна", {
        exact: false,
      }),
    ).toBeVisible();
  },
};
