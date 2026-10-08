import type { ReactNode } from "react";

import { PublicShell } from "@/_app";
import type { Viewport } from "next";

/**
 * Оболочка читает адрес через `usePathname()` в клиентском адаптере, поэтому у маршрута с параметром
 * нет предсобранной оболочки и прямой заход блокируется здесь, как и раньше. Переходы между
 * страницами внутри раскладки её не перерисовывают и проверяются на мгновенность (ADR 0027).
 */
export const instant = false;

/**
 * `viewportFit: "cover"` включает отступы `env(safe-area-inset-*)`: без него они на iPhone равны
 * нулю. Оболочка сама отступает от чёлки, скруглений и полосы «Домой».
 */
export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  viewportFit: "cover",
};

export default function PublicLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}
