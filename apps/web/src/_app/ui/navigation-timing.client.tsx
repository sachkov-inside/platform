"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";

/** Поля метрики, которые уходят в отметку; остальное Next.js оставляет себе. */
interface WebVitalMetric {
  readonly name: string;
  readonly rating?: string;
  readonly value: number;
}

/** Ссылка на колбэк обязана быть стабильной: хук подписывается заново на каждую новую функцию. */
function markWebVital(metric: WebVitalMetric): void {
  try {
    performance.mark(`inside:web-vital:${metric.name}`, {
      detail: { rating: metric.rating, value: metric.value },
    });
  } catch {
    // Измерение не должно мешать странице.
  }
}

/**
 * Замыкает измерение перехода: `instrumentation-client.ts` ставит отметку в момент нажатия, а здесь,
 * когда новый адрес уже отрисован, записывается длительность `inside:navigation`. Core Web Vitals
 * ложатся рядом отметками `inside:web-vital:*`; их читает набор проверок переходов. Всё остаётся в
 * User Timing браузера (ADR 0027).
 */
export function NavigationTiming() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useReportWebVitals(markWebVital);

  useEffect(() => {
    try {
      const start = performance.getEntriesByName("inside:navigation-start", "mark").at(-1);
      if (start === undefined) return;
      performance.measure("inside:navigation", {
        detail: { url: `${pathname}${search.length > 0 ? `?${search}` : ""}` },
        start: start.startTime,
      });
      performance.clearMarks("inside:navigation-start");
    } catch {
      // Измерение не должно мешать странице.
    }
  }, [pathname, search]);

  return null;
}
