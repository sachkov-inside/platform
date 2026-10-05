import { RefreshCw, SearchX, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui/button";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import { StatusPanel } from "@/shared/ui/status-panel";

/**
 * The route skeleton of a task page: the same column, return row and header as the page, and
 * at least a screen tall, so the footer waits below the fold.
 */
export function GuideTaskLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Задание загружается"
      className="mx-auto min-h-[calc(100dvh-8rem)] min-w-0 max-w-[43rem] pb-16"
      data-guide-task-state="loading"
      role="status"
    >
      <div className="flex min-h-15 items-center pt-4" data-task-return>
        <span className="h-4 w-48 rounded-full bg-placeholder/25" />
      </div>
      <div className="mt-4" data-task-header>
        <span className="block h-5 w-64 max-w-full rounded-full bg-placeholder/25" />
        <span className="mt-4 block h-8 w-4/5 rounded-full bg-placeholder/35" />
        <span className="mt-4 block h-8 w-40 rounded-full bg-placeholder/20" />
        <span className="mt-5 flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((item) => (
            <span
              className="h-9 w-24 rounded-full bg-placeholder/15"
              key={item}
            />
          ))}
        </span>
      </div>
      <div className="mt-10 grid gap-10">
        {[0, 1, 2].map((item) => (
          <div className="grid gap-3" key={item}>
            <span className="h-6 w-36 rounded-full bg-placeholder/30" />
            <span className="h-4 rounded-full bg-placeholder/15" />
            <span className="h-4 w-11/12 rounded-full bg-placeholder/15" />
            <span className="h-4 w-4/5 rounded-full bg-placeholder/15" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The task service paused: the reader keeps the address and retries; nothing is decided. */
export function GuideTaskUnavailable() {
  return (
    <StatusPanel
      action={<RetryPageButton />}
      icon={<ShieldAlert aria-hidden="true" />}
      message="Сервис заданий не отвечает. Попробуйте ещё раз через несколько минут."
      state={{ "data-guide-task-state": "unavailable" }}
      title="Задание временно недоступно"
    />
  );
}

/** An unknown, withdrawn or foreign task code answers 404 (#947). */
export function GuideTaskNotFound() {
  return (
    <>
      <title>Задание не найдено · Sachkov Inside</title>
      <StatusPanel
        action={
          <Button asChild size="lg">
            <Link href="/">На главную</Link>
          </Button>
        }
        icon={<SearchX aria-hidden="true" />}
        message="Такого задания нет или оно снято с публикации. Откройте программу продукта, чтобы найти задания глав."
        state={{ "data-guide-task-state": "not-found" }}
        title="Задание не найдено"
      />
    </>
  );
}

/** An unexpected failure of the task page; `retry` reads the page from the server again. */
export function GuideTaskUnexpectedError({
  onRetry,
}: {
  readonly onRetry: () => void;
}) {
  return (
    <StatusPanel
      action={
        <Button onClick={onRetry} size="lg">
          <RefreshCw aria-hidden="true" />
          Повторить
        </Button>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Страница задания не загрузилась. Попробуйте ещё раз."
      state={{ "data-guide-task-state": "error" }}
      title="Не удалось открыть задание"
    />
  );
}
