"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { defaultProductMode, type ProductMode } from "./product-mode";

interface ProductModeState {
  readonly mode: ProductMode;
  readonly select: (mode: ProductMode) => void;
}

const ProductModeContext = createContext<ProductModeState | null>(null);

/**
 * Активный режим прохождения руководства для одной страницы урока. Начальное значение приходит с
 * сервера, поэтому первый кадр уже показывает вариант читателя; переключение меняет содержание
 * сразу, а сохранением занимается тот, кто нарисовал переключатель.
 */
export function ProductModeProvider({
  children,
  initialMode,
}: {
  readonly children: ReactNode;
  readonly initialMode: ProductMode;
}) {
  const [mode, setMode] = useState(initialMode);
  // Покинутый урок Next.js не размонтирует, а прячет, и его состояние переживает уход (ADR 0027).
  // Режим, выбранный на соседнем уроке, приходит сюда новым значением с сервера: состояние идёт за
  // ним, иначе вернувшийся читатель увидел бы вариант шага для прежнего режима.
  const [servedMode, setServedMode] = useState(initialMode);
  if (servedMode !== initialMode) {
    setServedMode(initialMode);
    setMode(initialMode);
  }
  const value = useMemo<ProductModeState>(
    () => ({ mode, select: setMode }),
    [mode],
  );
  return (
    <ProductModeContext.Provider value={value}>
      {children}
    </ProductModeContext.Provider>
  );
}

/**
 * Режим за пределами страницы урока — это предпросмотр и каталог: там режим никто не выбирает, и
 * отсутствие обёртки означает режим по умолчанию, а не ошибку.
 */
export function useProductMode(): ProductModeState {
  return (
    useContext(ProductModeContext) ?? {
      mode: defaultProductMode,
      select: () => undefined,
    }
  );
}
