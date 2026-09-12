"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { defaultGuideMode, type GuideMode } from "./guide-mode";

interface GuideModeState {
  readonly mode: GuideMode;
  readonly select: (mode: GuideMode) => void;
}

const GuideModeContext = createContext<GuideModeState | null>(null);

/**
 * Активный режим прохождения руководства для одной страницы урока. Начальное значение приходит с
 * сервера, поэтому первый кадр уже показывает вариант читателя; переключение меняет содержание
 * сразу, а сохранением занимается тот, кто нарисовал переключатель.
 */
export function GuideModeProvider({
  children,
  initialMode,
  onSelect,
}: {
  readonly children: ReactNode;
  readonly initialMode: GuideMode;
  readonly onSelect?: (mode: GuideMode) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const value = useMemo<GuideModeState>(
    () => ({
      mode,
      select: (next) => {
        setMode(next);
        onSelect?.(next);
      },
    }),
    [mode, onSelect],
  );
  return <GuideModeContext.Provider value={value}>{children}</GuideModeContext.Provider>;
}

/**
 * Режим за пределами страницы урока — это предпросмотр и каталог: там режим никто не выбирает, и
 * отсутствие обёртки означает режим по умолчанию, а не ошибку.
 */
export function useGuideMode(): GuideModeState {
  return (
    useContext(GuideModeContext) ?? {
      mode: defaultGuideMode,
      select: () => undefined,
    }
  );
}
