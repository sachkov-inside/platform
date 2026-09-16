"use client";

import { useEffect, useId, useRef } from "react";

import type { GuideRemoval } from "@/shared/lib/guide-removal";
import { Button } from "@/shared/ui/button";

/**
 * Подтверждение снятия опубликованного материала из купленного продукта. Диалог называет каждый
 * продукт и сколько людей в нём держат доступ: без явного согласия автора сервер снятие не примет.
 */
export function GuideRemovalConfirmationDialog({
  guides,
  onCancel,
  onConfirm,
  pending = false,
}: {
  readonly guides: readonly GuideRemoval[];
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const headingId = `${id}-removal-heading`;
  const descriptionId = `${id}-removal-description`;

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    return () => {
      element?.close();
    };
  }, []);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={headingId}
      className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/45"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialog}
    >
      <div className="p-6 sm:p-8">
        <h2 className="text-balance text-2xl font-semibold tracking-[-0.03em]" id={headingId}>
          Снять материал из купленного продукта?
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" id={descriptionId}>
          У этих продуктов есть люди с действующим доступом. После снятия материал исчезнет из их
          программы. Снятие запишется в журнал.
        </p>
        <ul className="mt-5 grid gap-2">
          {guides.map((guide) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-border p-3 text-sm"
              key={guide.guideId}
            >
              <span className="font-medium">{guide.name.length > 0 ? `«${guide.name}»` : "Продукт без названия"}</span>
              <span className="text-muted-foreground">{holdersLabel(guide.holders)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button className="min-h-11" disabled={pending} onClick={onCancel} type="button" variant="outline">
            Оставить в продукте
          </Button>
          <Button className="min-h-11" disabled={pending} onClick={onConfirm} type="button" variant="destructive">
            Снять из продукта
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function holdersLabel(holders: number): string {
  const lastTwo = holders % 100;
  const last = holders % 10;
  const noun = last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "человека" : "человек";
  return `доступ у ${String(holders)} ${noun}`;
}
