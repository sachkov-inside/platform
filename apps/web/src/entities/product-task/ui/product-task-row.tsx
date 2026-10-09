import { CircleCheck, Flag, LockKeyhole } from "lucide-react";
import type { Route } from "next";

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import {
  formatSubmissionDay,
  type ProductChapterTask,
} from "../model/product-task";

/**
 * A Product Task in its chapter of the programme (#947, variant 2 accepted 05.10.2026): it stands
 * among Materials where the author placed it, carries no lesson number and shows «Сдано <дата>»
 * under its title once the reader submitted it.
 */
export function ProductTaskRow({
  accessPending = false,
  headingLevel: Heading = "h4",
  href,
  task,
}: {
  /** The personal part is still on its way: the lock waits for it instead of guessing. */
  readonly accessPending?: boolean;
  readonly headingLevel?: "h3" | "h4";
  readonly href: Route;
  readonly task: ProductChapterTask;
}) {
  const pending = accessPending && task.access !== "free";
  const locked = !pending && task.availability === "locked";
  const submitted = task.lastSubmittedAt;
  return (
    <article
      className="group/task relative flex min-h-14 min-w-0 items-center gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--callout-task)_32%,transparent)] bg-[color-mix(in_srgb,var(--callout-task)_6%,var(--card))] px-3 py-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--callout-task)_11%,var(--card))] focus-within:bg-[color-mix(in_srgb,var(--callout-task)_11%,var(--card))] sm:gap-3 sm:px-4"
      data-programme-task={task.code}
      data-task-availability={pending ? "pending" : task.availability}
    >
      {/* Та же строка, что у урока: флажок на месте номера, тип словом, название, статус. */}
      <span
        aria-hidden="true"
        className="grid w-6 shrink-0 place-items-center text-[color:var(--callout-task)] sm:w-7"
      >
        <Flag className="size-4" />
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 border-r border-[color-mix(in_srgb,var(--callout-task)_32%,transparent)] pr-2.5 text-[0.625rem] font-semibold uppercase leading-4 tracking-[0.08em] text-[color:var(--callout-task)] sm:pr-3"
      >
        Задание
      </span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">Задание. </span>
        <Heading className="min-w-0 text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6">
          <IntentPrefetchLink
            className="no-underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            href={href}
          >
            {task.title}
          </IntentPrefetchLink>
        </Heading>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {submitted === null ? null : (
          <span
            className="inline-flex items-center gap-1 font-semibold text-[color:var(--callout-good)]"
            data-task-submitted
          >
            <CircleCheck aria-hidden="true" className="size-4" />
            <span className="max-sm:sr-only">
              Сдано {formatSubmissionDay(submitted)}
            </span>
          </span>
        )}
        {pending ? (
          <span
            aria-hidden="true"
            className="size-4 animate-pulse rounded-full bg-placeholder/40 motion-reduce:animate-none"
          />
        ) : locked ? (
          <>
            <LockKeyhole aria-hidden="true" className="size-4" />
            <span className="sr-only">Нужен доступ</span>
          </>
        ) : task.availability === "unavailable" ? (
          <span className="sr-only">Доступ временно не определён</span>
        ) : null}
      </span>
    </article>
  );
}
