"use client";
import { useId, useState } from "react";

import { formatKopecks, type OfferEligibility } from "@/entities/subscription";
import { hasText } from "@/shared/lib/text";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import {
  eligibilityChoices,
  eligibilityLabel,
  parseEligibility,
  tariffOptionLabel,
  type TariffRow,
} from "../model/access-operations";
import { AdminSection } from "./admin-form.client";

export interface TariffsViewProps {
  readonly tariffs: readonly TariffRow[];
  readonly busy: boolean;
  readonly message: string;
  /** Отказ последней команды словами владельца. */
  readonly failure: string | null;
  readonly onSaveEligibility: (
    row: TariffRow,
    eligibility: OfferEligibility,
  ) => void;
  readonly onToggleSale: (row: TariffRow, published: boolean) => void;
}

/**
 * Тарифы: действующие Offer с ценами, кому каждый продаётся и включена ли продажа. Состав и цены
 * меняются в разделе «Оплата и права»; здесь только допуск и продажа.
 */
export function TariffsView(props: TariffsViewProps) {
  return (
    <div className="grid gap-6">
      <p aria-live="polite" className="break-words text-sm" role="status">
        {props.message}
      </p>
      {hasText(props.failure) ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm"
          role="alert"
        >
          {props.failure}
        </p>
      ) : null}
      <AdminSection
        title="Тарифы"
        description="«Только по приглашению» скрывает Offer с витрины: купить его может только тот, кто погасил приглашение. Снятие с продажи не трогает уже выданный доступ."
      >
        {props.tariffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            В каталоге нет действующих Offer. Заведите Offer в разделе «Оплата и
            права».
          </p>
        ) : (
          <ul className="grid gap-3">
            {props.tariffs.map((row) => (
              <TariffItem
                busy={props.busy}
                key={row.offer.id}
                onSaveEligibility={props.onSaveEligibility}
                onToggleSale={props.onToggleSale}
                row={row}
              />
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}

function TariffItem({
  busy,
  row,
  onSaveEligibility,
  onToggleSale,
}: {
  readonly busy: boolean;
  readonly row: TariffRow;
  readonly onSaveEligibility: TariffsViewProps["onSaveEligibility"];
  readonly onToggleSale: TariffsViewProps["onToggleSale"];
}) {
  const current = row.offer.eligibility ?? "everyone";
  const [eligibility, setEligibility] = useState<OfferEligibility>(current);
  const selectId = useId();
  const published = row.offer.published === true;
  return (
    <li
      aria-label={row.offer.name}
      className="grid min-w-0 gap-3 rounded-xl border border-border p-4 text-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-semibold">
          {row.offer.name}
        </span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            published
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted text-foreground",
          )}
        >
          {published ? "Продаётся" : "Не продаётся"}
        </span>
      </div>
      {row.options.length === 0 ? (
        <p className="text-muted-foreground">Нет действующих цен.</p>
      ) : (
        <ul aria-label="Цены" className="flex flex-wrap gap-2">
          {row.options.map((option) => (
            <li
              className="rounded-lg border border-border px-2.5 py-1"
              key={option.id}
            >
              {formatKopecks(option.priceKopecks)} · {tariffOptionLabel(option)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <p className="grid min-w-0 gap-1">
          <label className="font-semibold" htmlFor={selectId}>
            Кому продаётся
          </label>
          <select
            className="min-h-11 rounded-xl border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            id={selectId}
            onChange={(event) => {
              const next = parseEligibility(event.currentTarget.value);
              if (next !== null) setEligibility(next);
            }}
            value={eligibility}
          >
            {eligibilityChoices(current).map((choice) => (
              <option key={choice} value={choice}>
                {eligibilityLabel(choice)}
              </option>
            ))}
          </select>
        </p>
        <Button
          disabled={busy || eligibility === current}
          onClick={() => {
            onSaveEligibility(row, eligibility);
          }}
          type="button"
          variant="outline"
        >
          Сохранить допуск
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            onToggleSale(row, !published);
          }}
          type="button"
          variant={published ? "destructive" : "default"}
        >
          {published ? "Снять с продажи" : "Включить продажу"}
        </Button>
      </div>
    </li>
  );
}
