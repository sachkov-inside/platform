import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  ApplicationShell,
  publicMobileNavigationItems,
  publicNavigationItems,
} from "@/widgets/application-shell";

/** Throwaway #1566 proof: can people decline, reopen and withdraw consent? Memory only. */
function AnalyticsConsentProof({
  initial = "undecided",
}: {
  readonly initial?: "undecided" | "necessary" | "allowed";
}) {
  const [choice, setChoice] = useState(initial);
  const [open, setOpen] = useState(initial === "undecided");
  const [lessonOpen, setLessonOpen] = useState(false);
  const settings = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  function choose(next: "necessary" | "allowed") {
    setChoice(next);
    setOpen(false);
    settings.current?.focus();
  }
  return (
    <ApplicationShell
      currentPath="/"
      navigationItems={publicNavigationItems}
      mobileNavigationItems={publicMobileNavigationItems}
    >
      <div className="mx-auto max-w-3xl pb-96">
        <h1 className="text-3xl font-bold tracking-tight">
          Продолжить обучение
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Материалы и сохранённый прогресс доступны при любом выборе аналитики.
        </p>
        <section
          className="mt-8 border-y border-border py-6"
          aria-labelledby="lesson-heading"
        >
          <h2 id="lesson-heading" className="text-xl font-semibold">
            Работа с AI-агентами
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Демонстрационный материал для проверки доступа после отказа.
          </p>
          <Button
            className="mt-4 min-h-11 px-4"
            onClick={() => setLessonOpen(!lessonOpen)}
          >
            {lessonOpen ? "Закрыть материал" : "Открыть материал"}
          </Button>
          {lessonOpen && (
            <p className="mt-4 text-base leading-7">
              Материал открыт. Вы можете продолжить обучение.
            </p>
          )}
        </section>
        <section className="mt-8" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className="text-xl font-semibold">
            Конфиденциальность
          </h2>
          <p className="mt-2 text-sm leading-6" role="status">
            {choice === "allowed"
              ? "Аналитика разрешена."
              : choice === "necessary"
                ? "Только необходимые технологии. Аналитика выключена."
                : "Вы ещё не выбрали. Аналитика выключена."}
          </p>
          <Button
            ref={settings}
            variant="outline"
            className="mt-4 min-h-11 px-4"
            aria-expanded={open}
            aria-controls="analytics-settings"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => heading.current?.focus());
            }}
          >
            Настройки аналитики
          </Button>
        </section>
        <aside
          className="mt-10 text-sm leading-6 text-muted-foreground"
          aria-label="О прототипе"
        >
          Прототип #1566. Выбор хранится только до перезагрузки этой истории.
          Сбор данных не подключён.
        </aside>
      </div>
      {open && (
        <section
          id="analytics-settings"
          aria-labelledby="analytics-heading"
          className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground"
        >
          <h2
            id="analytics-heading"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            {choice === "undecided"
              ? "Разрешить аналитику?"
              : "Настройки аналитики"}
          </h2>
          <p className="mt-3 text-sm leading-6">
            Необходимые технологии обеспечивают вход и сохранение прогресса.
            Аналитика помогает понять, как используют сайт. Она включится только
            с вашего разрешения.
          </p>
          <p className="mt-2 text-sm leading-6">
            Отказ не ограничит доступ к продукту. Изменить выбор можно в
            «Настройках аналитики». При отзыве сбор сразу прекращается.
          </p>
          <a
            href="/legal/cookies"
            className="mt-2 inline-flex min-h-11 items-center text-sm text-action underline underline-offset-4"
          >
            Подробнее о технологиях и данных
          </a>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              className="min-h-11 px-4"
              onClick={() => choose("necessary")}
            >
              {choice === "allowed"
                ? "Отозвать разрешение"
                : "Только необходимые"}
            </Button>
            <Button
              variant="outline"
              className="min-h-11 px-4"
              onClick={() => choose("allowed")}
            >
              Разрешить
            </Button>
          </div>
          {choice !== "undecided" && (
            <Button
              variant="ghost"
              className="mt-3 min-h-11 w-full"
              onClick={() => {
                setOpen(false);
                settings.current?.focus();
              }}
            >
              Закрыть без изменений
            </Button>
          )}
        </section>
      )}
    </ApplicationShell>
  );
}

const meta = {
  title: "Patterns/Analytics consent proof",
  component: AnalyticsConsentProof,
  parameters: {
    docs: {
      description: {
        component:
          "Throwaway Storybook-only proof for #1566 / #1565. In-memory choice, no analytics or storage. Incumbent shell, tokens and Button. Owner visual acceptance pending.",
      },
    },
  },
} satisfies Meta<typeof AnalyticsConsentProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FirstVisit: Story = {};
export const NecessaryOnly: Story = { args: { initial: "necessary" } };
export const Allowed: Story = { args: { initial: "allowed" } };
