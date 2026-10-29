import { ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { FreeMaterialBadge } from "@/entities/material";
import { Button } from "@/shared/ui/button";

import type { FreeLessonCall } from "../model/purchase-product";

/** Слова призыва рядом: заголовок, объяснение и кнопка меняются вместе с тем, куда он ведёт. */
const actionCopy = {
  purchase: {
    explanation: "Остальные уроки и задания курса открываются после покупки.",
    label: "Приобрести курс",
  },
  course: {
    explanation: "Остальные уроки и задания входят в полный курс.",
    label: "Подробнее о курсе",
  },
} as const;

/**
 * Призыв в конце бесплатного урока курса (#1647): урок отмечен бесплатным, закрытый следующий шаг
 * назван закрытым, а кнопка ведёт на оплату курса или, пока он не продаётся, на его страницу.
 */
export function FreeLessonPurchaseCallView({
  call,
}: {
  readonly call: FreeLessonCall;
}) {
  const copy = actionCopy[call.action.kind];
  return (
    <section
      aria-labelledby="free-lesson-call-heading"
      className="mt-8 rounded-2xl border border-black/6 bg-muted p-5 sm:p-6"
      data-free-lesson-call={call.action.kind}
    >
      <FreeMaterialBadge />
      <h2
        className="mt-3 text-balance text-lg font-semibold tracking-[-0.02em] sm:text-xl"
        id="free-lesson-call-heading"
      >
        {call.lockedNext === null
          ? "Этот урок открыт бесплатно"
          : "Дальше уроки полного курса"}
      </h2>
      {call.lockedNext === null ? null : (
        <p className="mt-3 flex items-start gap-2 text-sm leading-6 [overflow-wrap:anywhere]">
          <LockKeyhole
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-accent"
          />
          <span>Следующий шаг закрыт: «{call.lockedNext}»</span>
        </p>
      )}
      <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
        {copy.explanation}
      </p>
      <Button
        asChild
        className="mt-4 h-auto min-h-11 max-w-full whitespace-normal rounded-xl bg-accent px-4 text-white hover:bg-accent-hover"
        size="lg"
      >
        <Link href={call.action.href}>
          {copy.label}
          <ArrowRight
            aria-hidden="true"
            className="shrink-0 transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] group-hover/button:translate-x-0.5 motion-reduce:transition-none"
            data-icon="inline-end"
          />
        </Link>
      </Button>
    </section>
  );
}
