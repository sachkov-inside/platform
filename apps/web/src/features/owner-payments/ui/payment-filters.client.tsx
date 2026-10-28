"use client";

import { useState } from "react";

import { usePersonTitleText } from "@/entities/authoring-person";
import {
  AdminFilterBar,
  DateField,
  type AdminFilterChip,
} from "@/shared/ui/admin";

import {
  fulfillmentFilterLabel,
  hasPaymentsFilters,
  paymentStates,
  paymentsPeriodLabel,
  withPaymentsFilter,
  type PaymentState,
  type PaymentsQuery,
} from "../model/payment-filters";
import { paymentStateLabels } from "../model/payment-presentation";
import {
  ProductFilter,
  productChoiceLabel,
  type ProductChoices,
} from "./product-filter.client";

import "./owner-payments.css";

const anyState = "all";
const severalStates = "several";

/**
 * Фильтры списка платежей: продукт по названию, период по московским дням и состояние. Выбор
 * хранит адрес страницы; модуль только показывает его и сообщает об изменении. Покупатель
 * (`?person=` из карточки человека) виден плашкой, которую можно снять.
 */
export function PaymentFilters({
  query,
  onQueryChange,
  products,
  resultLabel,
}: {
  readonly query: PaymentsQuery;
  readonly onQueryChange: (query: PaymentsQuery) => void;
  readonly products: ProductChoices;
  readonly resultLabel?: string | undefined;
}) {
  const filtered = hasPaymentsFilters(query);
  const personTitle = usePersonTitleText(query.accountId);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="owner-payments-fields">
        <ProductFilter
          choices={products}
          onChange={(productId) => {
            onQueryChange(
              withPaymentsFilter(query, { key: "productId", value: productId }),
            );
          }}
          value={query.productId}
        />
        <PeriodDay
          label="С какого дня"
          max={query.to}
          onCommit={(day) => {
            onQueryChange(
              withPaymentsFilter(query, { key: "from", value: day }),
            );
          }}
          value={query.from}
        />
        <PeriodDay
          label="По какой день"
          min={query.from}
          onCommit={(day) => {
            onQueryChange(withPaymentsFilter(query, { key: "to", value: day }));
          }}
          value={query.to}
        />
      </div>
      <AdminFilterBar
        chips={paymentsFilterChips(query, products, personTitle).map(
          (chip) => ({
            ...chip,
            onRemove: () => {
              onQueryChange(chip.next);
            },
          }),
        )}
        filters={[
          {
            id: "state",
            label: "Состояние оплаты",
            onChange: (value) => {
              if (value === severalStates) return;
              const state = paymentStates.find((item) => item === value);
              onQueryChange(
                withPaymentsFilter(query, {
                  key: "states",
                  value: state === undefined ? [] : [state],
                }),
              );
            },
            options: [
              { label: "Все состояния", value: anyState },
              ...paymentStates.map((state) => ({
                label: paymentStateLabels[state],
                value: state,
              })),
              ...(query.states.length > 1
                ? [
                    {
                      label: `Несколько состояний: ${String(query.states.length)}`,
                      value: severalStates,
                    },
                  ]
                : []),
            ],
            value:
              query.states.length === 0
                ? anyState
                : query.states.length === 1
                  ? (query.states[0] ?? anyState)
                  : severalStates,
          },
        ]}
        onReset={
          filtered
            ? () => {
                onQueryChange({ states: [] });
              }
            : undefined
        }
        resultLabel={resultLabel}
      />
    </div>
  );
}

interface PaymentsFilterChip extends Omit<AdminFilterChip, "onRemove"> {
  readonly next: PaymentsQuery;
}

/**
 * Плашка на каждое состояние, продукт, период, выдачу и покупателя; снятие плашки убирает только
 * её выбор. Покупатель назван подписью человека, а не номером аккаунта.
 */
export function paymentsFilterChips(
  query: PaymentsQuery,
  products: ProductChoices,
  personTitle: string | null = null,
): readonly PaymentsFilterChip[] {
  const chips: PaymentsFilterChip[] = query.states.map((state) => ({
    id: `state-${state}`,
    label: paymentStateLabels[state],
    next: withPaymentsFilter(query, {
      key: "states",
      value: query.states.filter((item: PaymentState) => item !== state),
    }),
  }));
  if (query.productId !== undefined)
    chips.push({
      id: "product",
      label: productChoiceLabel(query.productId, products),
      next: withPaymentsFilter(query, { key: "productId", value: undefined }),
    });
  const period = paymentsPeriodLabel(query);
  if (period !== undefined)
    chips.push({
      id: "period",
      label: period,
      next: withPaymentsFilter(query, { key: "period", value: undefined }),
    });
  if (query.fulfillment !== undefined)
    chips.push({
      id: "fulfillment",
      label: fulfillmentFilterLabel,
      next: withPaymentsFilter(query, { key: "fulfillment", value: undefined }),
    });
  if (query.accountId !== undefined)
    chips.push({
      id: "person",
      label: `Покупатель: ${personTitle ?? "выбранный человек"}`,
      next: withPaymentsFilter(query, { key: "accountId", value: undefined }),
    });
  return chips;
}

/** Первый год, который поле принимает как выбор: пока год вводится по цифре, «0202» ещё не дата. */
const firstPlausibleDay = "2000-01-01";

/**
 * День периода. Поле держит то, что вводит человек, и сообщает о выборе только полной датой, поэтому
 * ввод года по цифре не порождает запросов и записей истории. Выбор извне (плашка, «Сбросить»,
 * «назад») поле принимает сразу.
 */
function PeriodDay({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly min?: string | undefined;
  readonly max?: string | undefined;
  readonly onCommit: (day: string | undefined) => void;
}) {
  const committed = value ?? "";
  const [draft, setDraft] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    setSeen(committed);
    setDraft(committed);
  }
  return (
    <DateField
      label={label}
      onChange={(next) => {
        setDraft(next);
        if (next === "") {
          if (committed !== "") onCommit(undefined);
          return;
        }
        if (next < firstPlausibleDay) return;
        if (min !== undefined && next < min) return;
        if (max !== undefined && next > max) return;
        if (next !== committed) onCommit(next);
      }}
      value={draft}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
    />
  );
}
