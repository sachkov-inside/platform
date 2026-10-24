import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { Button } from "@/shared/ui/button";
import { AnalyticsChoicePanel } from "./analytics-choice-panel.client";

function ConsentProof({
  storageUnavailable = false,
}: {
  readonly storageUnavailable?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [lesson, setLesson] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <h1 className="text-3xl font-semibold">Продолжить обучение</h1>
      <p className="mt-3 text-base leading-7 text-muted-foreground">
        Материалы и сохранённый прогресс доступны при любом выборе аналитики.
      </p>
      <section className="mt-8 border-y border-border py-6">
        <h2 className="text-xl font-semibold">Работа с AI-агентами</h2>
        <Button
          className="mt-4 min-h-11 px-4"
          onClick={() => {
            setLesson(true);
          }}
        >
          Открыть материал
        </Button>
        {lesson ? (
          <p className="mt-4 leading-7">
            Материал открыт. Можно продолжить обучение.
          </p>
        ) : null}
      </section>
      <Button
        variant="link"
        className="mt-5 min-h-11 px-0"
        onClick={() => {
          setOpen(true);
        }}
      >
        Настройки cookies и аналитики
      </Button>
      <p role="status" className="text-sm leading-6 text-muted-foreground">
        {allowed ? "Аналитика разрешена." : "Аналитика выключена."}
      </p>
      <p className="mt-8 text-sm leading-6 text-muted-foreground">
        Прототип #1566. Данные не отправляются. Выбор в этой истории хранится до
        перезагрузки.
      </p>
      {open ? (
        <AnalyticsChoicePanel
          policyHref="/legal/cookies"
          error={error}
          onChoose={(choice) => {
            if (storageUnavailable) {
              setError(true);
              return;
            }
            setAllowed(choice === "allowed");
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
const environment = publicPageEnvironment("/");
const meta = {
  ...environment,
  title: "Patterns/Analytics choice",
  component: ConsentProof,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Один общий выбор cookies и аналитики, без запроса при регистрации. Непринятый proof #1566, реальная активация ждёт legal и owner visual GO.",
      },
    },
  },
} satisfies Meta<typeof ConsentProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
export const ReversibleChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Только необходимые" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть материал" }),
    );
    await expect(
      canvas.getByText("Материал открыт. Можно продолжить обучение."),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Настройки cookies и аналитики" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: /^Разрешить$/ }));
    await expect(canvas.getByText("Аналитика разрешена.")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Настройки cookies и аналитики" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Только необходимые" }),
    );
    await expect(canvas.getByText("Аналитика выключена.")).toBeVisible();
  },
};
export const StorageUnavailable: Story = { args: { storageUnavailable: true } };
