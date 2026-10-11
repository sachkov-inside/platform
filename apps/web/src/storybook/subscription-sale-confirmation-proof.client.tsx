"use client";

import { useEffect, useId, useRef, useState } from "react";

import { AccessSection } from "@/_pages/access-admin/ui/access-section.client";
import { TariffsView, type TariffsViewProps } from "@/features/billing-admin";
import { Button } from "@/shared/ui/button";

type Tariff = TariffsViewProps["tariffs"][number];

/**
 * Throwaway UI proof #781: one warning using the existing native confirmation structure.
 * Storybook-only callbacks never save eligibility or publish an offer. Not production wiring.
 */
export function SubscriptionSaleConfirmationProof({
  tariff,
  onCancel,
  onConfirm,
}: {
  readonly tariff: Tariff;
  readonly onCancel: () => void;
  readonly onConfirm: (tariff: Tariff) => void;
}) {
  const [pending, setPending] = useState<Tariff | null>(null);
  const [message, setMessage] = useState(
    "Прототип предупреждения. Допуск и продажи не меняются.",
  );
  const trigger = useRef<HTMLElement | null>(null);

  return (
    <AccessSection
      tabs={[
        {
          id: "tariffs",
          label: "Тарифы",
          panel: (
            <>
              <TariffsView
                busy={false}
                failure={null}
                message={message}
                onSaveEligibility={() => {
                  setMessage(
                    "Прототип не сохраняет допуск и не включает продажу.",
                  );
                }}
                onToggleSale={(row) => {
                  const active = document.activeElement;
                  trigger.current =
                    active instanceof HTMLElement ? active : null;
                  setPending(row);
                }}
                tariffs={[tariff]}
              />
              {pending === null ? null : (
                <SubscriptionSaleConfirmationDialog
                  offerName={pending.offer.name}
                  onCancel={() => {
                    setPending(null);
                    onCancel();
                  }}
                  onConfirm={() => {
                    setPending(null);
                    setMessage(
                      "Подтверждение принято в прототипе. Продажа не включена.",
                    );
                    onConfirm(pending);
                  }}
                  trigger={trigger.current}
                />
              )}
            </>
          ),
        },
      ]}
    />
  );
}

/** Same native dialog structure and typography as ProductRemovalConfirmationDialog. */
function SubscriptionSaleConfirmationDialog({
  offerName,
  onCancel,
  onConfirm,
  trigger,
}: {
  readonly offerName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly trigger: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
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
            onClick={onCancel}
            ref={cancel}
            type="button"
            variant="outline"
          >
            Отмена
          </Button>
          <Button
            className="min-h-11"
            onClick={() => {
              if (confirmed.current) return;
              confirmed.current = true;
              onConfirm();
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
