"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "@/shared/ui/button";

/** Same native dialog structure and typography as ProductRemovalConfirmationDialog. */
export function SubscriptionSaleConfirmationDialog({
  offerName,
  onCancel,
  onConfirm,
  trigger,
  busy,
}: {
  readonly offerName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly trigger: HTMLElement | null;
  readonly busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const decided = useRef(false);
  const id = useId();
  const headingId = `${id}-sale-heading`;
  const descriptionId = `${id}-sale-description`;

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (trigger?.isConnected === true) trigger.focus();
    };
  }, [trigger]);

  function finish(action: () => void) {
    if (decided.current) return;
    decided.current = true;
    dialog.current?.close();
    // Restore before the command can disable its button while awaiting the server.
    if (trigger?.isConnected === true) trigger.focus();
    action();
  }

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={headingId}
      className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/45"
      onCancel={(event) => {
        event.preventDefault();
        finish(onCancel);
      }}
      ref={dialog}
    >
      <div className="p-6 sm:p-8">
        <h2
          className="text-balance text-2xl font-semibold tracking-[-0.03em]"
          id={headingId}
        >
          Включить продажу подписки всем?
        </h2>
        <p
          className="mt-3 text-sm leading-6 text-muted-foreground"
          id={descriptionId}
        >
          У предложения «{offerName}» сохранён допуск «Всем». После включения
          оно станет доступно для покупки всем. Чтобы продавать только по
          приглашению, отмените действие и сохраните другой допуск.
        </p>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            className="min-h-11"
            onClick={() => {
              finish(onCancel);
            }}
            ref={cancel}
            type="button"
            variant="outline"
          >
            Отмена
          </Button>
          <Button
            className="min-h-11"
            disabled={busy}
            onClick={() => {
              finish(onConfirm);
            }}
            type="button"
          >
            Включить продажу всем
          </Button>
        </div>
      </div>
    </dialog>
  );
}
