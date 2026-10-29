import { ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { FreeMaterialBadge } from "@/entities/material";
import { Button } from "@/shared/ui/button";

import type { FreeLessonCall } from "../model/purchase-product";

const actionLabel = {
  purchase: "Приобрести курс",
  course: "Подробнее о курсе",
} as const;

/**
 * Призыв в конце бесплатного урока курса (#1647). Состояние показывает сам вид, без поясняющих
 * фраз (DESIGN.md): закрытый следующий шаг стоит с замком и названием, иначе урок отмечен
 * бесплатным; рядом кнопка на оплату курса или, пока он не продаётся, на его страницу.
 */
export function FreeLessonPurchaseCallView({
  call,
}: {
  readonly call: FreeLessonCall;
}) {
  return (
    <section
      aria-label="Продолжение курса"
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/6 bg-muted px-4 py-3 sm:px-5"
      data-free-lesson-call={call.action.kind}
    >
      {call.lockedNext === null ? (
        <FreeMaterialBadge />
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-accent">
            <LockKeyhole aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs leading-5 text-muted-foreground">
              Следующий шаг
            </span>
            <span className="block text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
              <span className="sr-only">Закрыт: </span>
              {call.lockedNext}
            </span>
          </span>
        </span>
      )}
      <Button
        asChild
        className="h-auto min-h-11 max-w-full shrink-0 whitespace-normal rounded-xl bg-accent px-4 text-white hover:bg-accent-hover"
      >
        <Link href={call.action.href}>
          {actionLabel[call.action.kind]}
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
