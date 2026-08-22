"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./visual-concepts.module.css";

const variants = [
  ["workshop", "Soft Technical Workshop"],
  ["atlas", "Living Knowledge Atlas"],
  ["studio", "Quiet Content Studio"],
] as const;

const states = [
  ["results", "Результаты"],
  ["empty", "Пусто"],
] as const;

type PrototypeSwitcherProps = Readonly<{
  current: (typeof variants)[number][0];
  state: (typeof states)[number][0];
}>;

function ArrowIcon({ direction }: Readonly<{ direction: "left" | "right" }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d={direction === "left" ? "m12.5 4.5-5.5 5.5 5.5 5.5" : "m7.5 4.5 5.5 5.5-5.5 5.5"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

export function PrototypeSwitcher({ current, state }: PrototypeSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentIndex = variants.findIndex(([key]) => key === current);

  const setParams = (next: Readonly<Record<string, string>>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(next)) {
      params.set(key, value);
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const cycle = (offset: number) => {
    const nextIndex = (currentIndex + offset + variants.length) % variants.length;
    setParams({ variant: variants[nextIndex][0] });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isEditing || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
        return;
      }

      event.preventDefault();
      cycle(event.key === "ArrowLeft" ? -1 : 1);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <aside aria-label="Управление visual prototype" className={styles.prototypeSwitcher}>
      <div className={styles.switcherVariants}>
        <button aria-label="Предыдущий concept" onClick={() => cycle(-1)} type="button">
          <ArrowIcon direction="left" />
        </button>
        <p aria-live="polite">
          <span>{currentIndex + 1} / {variants.length}</span>
          {variants[currentIndex][1]}
        </p>
        <button aria-label="Следующий concept" onClick={() => cycle(1)} type="button">
          <ArrowIcon direction="right" />
        </button>
      </div>
      <div aria-label="Состояние Библиотеки" className={styles.switcherStates} role="group">
        {states.map(([key, label]) => (
          <button
            aria-pressed={state === key}
            key={key}
            onClick={() => setParams({ state: key })}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}
