"use client";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/** Одна вкладка раздела: своя панель со своими данными и операциями. */
export interface AccessTab {
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
}

/**
 * Раздел «Доступ» владельца: вкладки над одним каталогом. Вкладка появляется в списке, только
 * когда у неё есть рабочая панель, поэтому пустых заглушек раздел не показывает. Невыбранные
 * панели скрыты, но остаются смонтированными: ревизии каталога, начатые команды и их повторы
 * переживают переключение вкладок.
 */
export function AccessSection({
  tabs,
}: {
  readonly tabs: readonly [AccessTab, ...AccessTab[]];
}) {
  const [currentId, setCurrentId] = useState(tabs[0].id);
  const baseId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const current = tabs.find((tab) => tab.id === currentId) ?? tabs[0];

  // Стрелки переводят фокус и выбор по кругу, как в обычном списке вкладок.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === current.id);
    const next = tabs[(index + step + tabs.length) % tabs.length] ?? current;
    setCurrentId(next.id);
    buttons.current.get(next.id)?.focus();
  }

  return (
    <main
      aria-labelledby={`${baseId}-title`}
      className="flex h-full min-h-svh flex-col overflow-y-auto bg-background text-foreground md:min-h-0 md:overscroll-y-contain"
      data-access-section
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto grid w-full max-w-4xl content-start gap-6 px-4 py-7 pb-16 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
        <header className="grid gap-2">
          <h1
            className="text-balance text-3xl font-bold tracking-[-0.04em]"
            id={`${baseId}-title`}
          >
            Доступ
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Кто и как получает доступ к Inside: тарифы, личные приглашения через
            бота, люди с их основаниями и сводка.
          </p>
        </header>
        <div
          aria-label="Разделы доступа"
          className="flex flex-wrap gap-1 border-b border-border"
          onKeyDown={onKeyDown}
          role="tablist"
        >
          {tabs.map((tab) => {
            const selected = tab.id === current.id;
            return (
              <button
                aria-controls={`${baseId}-panel-${tab.id}`}
                aria-selected={selected}
                className={cn(
                  "-mb-px min-h-11 border-b-2 px-3 text-sm font-medium transition-colors motion-reduce:transition-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                id={`${baseId}-tab-${tab.id}`}
                key={tab.id}
                onClick={() => {
                  setCurrentId(tab.id);
                }}
                ref={(node) => {
                  if (node === null) buttons.current.delete(tab.id);
                  else buttons.current.set(tab.id, node);
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {tabs.map((tab) => (
          <div
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            hidden={tab.id !== current.id}
            id={`${baseId}-panel-${tab.id}`}
            key={tab.id}
            role="tabpanel"
          >
            {tab.panel}
          </div>
        ))}
      </div>
    </main>
  );
}
