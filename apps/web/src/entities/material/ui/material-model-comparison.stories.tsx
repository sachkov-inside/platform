import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MaterialModelComparison } from "./material-model-comparison.client";

const meta = {
  component: MaterialModelComparison,
  title: "Entities/Material Model Comparison",
  decorators: [
    (Story) => (
      <article className="mx-auto max-w-[72ch] px-4 py-8">
        <h2 className="text-xl font-semibold">
          Какого агента и подписку выбрать
        </h2>
        <Story />
      </article>
    ),
  ],
  args: {
    items: [
      {
        label: "Claude",
        title: "Claude Opus 5.5 / Sonnet 5.5",
        content: (
          <>
            <p>
              <strong>Где использовать.</strong>Claude Code с подпиской Claude;
              также через совместимые API-подключения.
            </p>
            <p>
              <strong>Цена.</strong>
              <a href="https://claude.com/pricing" className="underline">
                Тарифы Claude
              </a>
            </p>
            <p>
              <strong>Примерные лимиты.</strong>Сравнение лимитов подписок.
            </p>
            <p>
              <strong>Моё мнение.</strong>Длинный текст сравнения сохраняется в
              карточке и переносится на телефоне. Каждую модель можно выбрать
              отдельно, чтобы читать её условия без широкой таблицы.
            </p>
          </>
        ),
      },
      {
        label: "GPT",
        title: "GPT-6.1 Sol / GPT-6 Luna",
        content: (
          <p>
            <strong>Цена.</strong>
            <a
              href="https://learn.chatgpt.com/docs/pricing"
              className="underline"
            >
              Тарифы ChatGPT
            </a>
          </p>
        ),
      },
      {
        label: "DeepSeek",
        title: "DeepSeek V4.1 Flash",
        content: (
          <p>
            <strong>Где использовать.</strong>OpenCode и DeepSeek Harness.
          </p>
        ),
      },
      {
        label: "GLM",
        title: "GLM-5.3-Flash",
        content: (
          <p>
            <strong>Где использовать.</strong>OpenCode.
          </p>
        ),
      },
      {
        label: "Kimi",
        title: "Kimi K3",
        content: (
          <p>
            <strong>Где использовать.</strong>OpenCode.
          </p>
        ),
      },
    ],
  },
} satisfies Meta<typeof MaterialModelComparison>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Models: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Claude Opus 5.5 / Sonnet 5.5" }),
    ).toBeVisible();
    const gpt = canvas.getByRole("button", { name: "GPT" });
    await userEvent.click(gpt);
    await expect(gpt).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.queryByRole("region", { name: "Claude Opus 5.5 / Sonnet 5.5" }),
    ).toBeNull();
    await expect(
      canvas.getByRole("link", { name: "Тарифы ChatGPT" }),
    ).toBeVisible();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect(
      canvas.getByRole("button", { name: "DeepSeek" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Claude" }));
  },
};
export const ModelsMobile: Story = {
  ...Models,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const ModelsDark: Story = { ...Models, globals: { theme: "dark" } };
