import { CircleCheck, Flag, LockKeyhole } from "lucide-react";
import type { Route } from "next";

import { cn } from "@/shared/lib/utils";
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
  return (
    <article
      className="group/task relative flex min-h-14 min-w-0 items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--callout-task)_32%,transparent)] bg-[color-mix(in_srgb,var(--callout-task)_6%,var(--card))] px-3 py-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--callout-task)_11%,var(--card))] focus-within:bg-[color-mix(in_srgb,var(--callout-task)_11%,var(--card))] sm:min-h-16 sm:gap-3 sm:px-4 sm:py-3"
      data-programme-task={task.code}
      data-task-availability={pending ? "pending" : task.availability}
    >
      {/* Значок задания в той же узкой колонке, где у урока его номер: без плитки. На телефоне
          колонки нет — название задания получает всю ширину, как у урока. */}
      <span
        aria-hidden="true"
        className="grid w-7 shrink-0 place-items-center pt-0.5 text-[color:var(--callout-task)] max-sm:hidden"
      >
        {locked ? (
          <LockKeyhole className="size-4" />
        ) : (
          <Flag className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.6875rem] font-semibold uppercase leading-4 tracking-wider text-[color:var(--callout-task)]">
          Задание
        </p>
        <Heading className="min-w-0 text-sm font-medium leading-6 [overflow-wrap:anywhere] sm:text-base">
          <IntentPrefetchLink
            className="no-underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            href={href}
          >
            {task.title}
          </IntentPrefetchLink>
        </Heading>
        {task.lastSubmittedAt === null ? null : (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--callout-good)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-[color:var(--callout-good)]"
            data-task-submitted
          >
            <CircleCheck aria-hidden="true" className="size-3.5" />
            Сдано {formatSubmissionDay(task.lastSubmittedAt)}
          </span>
        )}
        {task.access === "free" &&
        task.availability === "available" &&
        task.lastSubmittedAt === null ? (
          <span className="mt-1 inline-block rounded-md bg-background px-1.5 py-0.5 text-[0.625rem] font-semibold leading-4 text-action">
            Бесплатно
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center text-xs text-muted-foreground",
          pending ? "" : "sr-only",
        )}
      >
        {pending ? (
          <span
            aria-hidden="true"
            className="size-4 animate-pulse rounded-full bg-placeholder/40 motion-reduce:animate-none"
          />
        ) : locked ? (
          "Нужен доступ"
        ) : task.availability === "unavailable" ? (
          "Доступ временно не определён"
        ) : null}
      </span>
    </article>
  );
}
