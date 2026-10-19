import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  ApplicationShell,
  publicMobileNavigationItems,
  publicNavigationItems,
} from "@/widgets/application-shell";

/** Throwaway #1566 unified StorageNotice replacement. Existing acknowledgement is not consent. Memory only; no second prompt on registration. */
function AnalyticsConsentProof({
  initial = "undecided",
}: {
  readonly initial?: "undecided" | "necessary" | "allowed";
}) {
  const [choice, setChoice] = useState(initial);
  const [open, setOpen] = useState(initial === "undecided");
  const [lessonOpen, setLessonOpen] = useState(false);
  const settings = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = notice.current;
    if (!open || element === null) return;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => {
      root.setProperty(
        "--storage-notice-space",
        `${String(element.offsetHeight)}px`,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeProperty("--storage-notice-space");
    };
  }, [open]);
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
      <div className="mx-auto max-w-3xl">
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
        <footer className="mt-8">
          <Button
            ref={settings}
            variant="link"
            className="min-h-11 px-0"
            aria-expanded={open}
            aria-controls="storage-settings"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => notice.current?.focus());
            }}
          >
            Настройки cookies и аналитики
          </Button>
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            {choice === "allowed"
              ? "Аналитика разрешена."
              : "Аналитика выключена."}
          </p>
        </footer>
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
          id="storage-settings"
          ref={notice}
          tabIndex={-1}
          aria-label="Cookies и аналитика"
          className="storage-notice fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
        >
          <p className="text-sm leading-6">
            Необходимые технологии сохраняют вход и прогресс. Аналитика помогает
            улучшать сайт и включается только с вашего разрешения. Отказ не
            ограничит доступ.
          </p>
          <a
            href="/legal/cookies"
            className="mt-2 inline-flex min-h-11 items-center text-sm text-action underline underline-offset-4"
          >
            Подробнее
          </a>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              className="min-h-11 px-4"
              onClick={() => choose("necessary")}
            >
              Только необходимые
            </Button>
            <Button
              variant="outline"
              className="min-h-11 px-4"
              onClick={() => choose("allowed")}
            >
              Разрешить аналитику
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
          "Revised throwaway #1566 / #1565 proof: one minimalist replacement for the existing storage notice, not an additional consent popup. The same banner opens from one settings entry for withdrawal. No registration step. Memory only, no analytics or storage. Earlier proof superseded; owner visual acceptance pending.",
      },
    },
  },
} satisfies Meta<typeof AnalyticsConsentProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FirstVisit: Story = {};
export const NecessaryOnly: Story = { args: { initial: "necessary" } };
export const Allowed: Story = { args: { initial: "allowed" } };
