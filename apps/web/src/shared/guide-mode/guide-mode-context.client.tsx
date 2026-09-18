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
}: {
  readonly children: ReactNode;
  readonly initialMode: GuideMode;
}) {
  const [mode, setMode] = useState(initialMode);
  // Покинутый урок Next.js не размонтирует, а прячет, и его состояние переживает уход (ADR 0026).
  // Режим, выбранный на соседнем уроке, приходит сюда новым значением с сервера: состояние идёт за
  // ним, иначе вернувшийся читатель увидел бы вариант шага для прежнего режима.
  const [servedMode, setServedMode] = useState(initialMode);
  if (servedMode !== initialMode) {
    setServedMode(initialMode);
    setMode(initialMode);
  }
  const value = useMemo<GuideModeState>(() => ({ mode, select: setMode }), [mode]);
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
