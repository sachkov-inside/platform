/**
 * Начало перехода App Router (ADR 0026). Отметка остаётся в User Timing браузера: её видно в
 * панели Performance и читают проверки переходов. Наружу ничего не уходит — сторонней аналитики
 * у площадки нет, и измерение её не заводит.
 */
export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
): void {
  try {
    performance.mark("inside:navigation-start", { detail: { navigationType, url } });
  } catch {
    // Измерение не должно мешать переходу.
  }
}
