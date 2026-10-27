"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoscowDate } from "@/shared/lib/moscow-format";
import { AdminFilterBar, DateField } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  defaultFunnelPeriodPreset,
  funnelPeriodPresets,
  isValidCustomPeriod,
  salesFunnelHref,
  withFunnelChapter,
  withFunnelPeriod,
  withFunnelProduct,
  type FunnelPeriod,
  type SalesFunnelQuery,
} from "../model/sales-funnel-query";
import type { SalesFunnelReportView } from "../model/sales-funnel-report";

const customValue = "custom";

function presetLabel(days: number): string {
  return `Последние ${String(days)} дней`;
}

/** Период отчёта словами: готовый период или даты своего. */
export function funnelPeriodLabel(view: SalesFunnelReportView): string {
  return view.preset === null
    ? `${formatMoscowDate(view.from)} – ${formatMoscowDate(view.to)}`
    : presetLabel(view.preset);
}

/** Что показано сейчас, в форме адреса: отсюда фильтр строит следующий адрес. */
function currentQuery(view: SalesFunnelReportView): SalesFunnelQuery {
  const period: FunnelPeriod =
    view.preset === null
      ? { kind: "custom", from: view.from, to: view.to }
      : { kind: "preset", days: view.preset };
  return { productId: view.productId, chapterId: view.chapterId, period };
}

/**
 * Продукт, глава и период отчёта одной строкой. Выбор пишет адрес, и страница читает отчёт
 * заново: ссылка и «назад» возвращают тот же отчёт. Свой период задаётся двумя датами.
 */
export function SalesFunnelFilters({
  view,
}: {
  readonly view: SalesFunnelReportView;
}) {
  const router = useRouter();
  const query = currentQuery(view);
  const [customOpen, setCustomOpen] = useState(view.preset === null);
  const [from, setFrom] = useState(view.from);
  const [to, setTo] = useState(view.to);
  const [periodError, setPeriodError] = useState("");
  const product = view.products.find((item) => item.id === view.productId);
  const firstProduct = view.products[0];
  const isDefault =
    view.preset === defaultFunnelPeriodPreset &&
    (firstProduct === undefined || view.productId === firstProduct.id) &&
    (product === undefined ||
      view.chapterId === (product.chapters[0]?.id ?? null));
  const go = (next: SalesFunnelQuery) => {
    router.push(salesFunnelHref(next));
  };

  return (
    <div className="grid gap-3" data-sales-funnel-filters>
      <AdminFilterBar
        chips={
          view.preset === defaultFunnelPeriodPreset
            ? []
            : [
                {
                  id: "period",
                  label: funnelPeriodLabel(view),
                  onRemove: () => {
                    go(
                      withFunnelPeriod(query, {
                        kind: "preset",
                        days: defaultFunnelPeriodPreset,
                      }),
                    );
                  },
                },
              ]
        }
        filters={[
          ...(view.products.length === 0
            ? []
            : [
                {
                  id: "product",
                  label: "Продукт",
                  onChange: (value: string) => {
                    go(withFunnelProduct(query, value));
                  },
                  options: view.products.map((item) => ({
                    label: item.name,
                    value: item.id,
                  })),
                  value: view.productId ?? "",
                },
              ]),
          ...(product === undefined || product.chapters.length === 0
            ? []
            : [
                {
                  id: "chapter",
                  label: "Глава",
                  onChange: (value: string) => {
                    go(withFunnelChapter(query, product.id, value));
                  },
                  options: product.chapters.map((item) => ({
                    label: item.name,
                    value: item.id,
                  })),
                  value: view.chapterId ?? "",
                },
              ]),
          {
            id: "period",
            label: "Период",
            onChange: (value: string) => {
              if (value === customValue) {
                setCustomOpen(true);
                return;
              }
              const days = funnelPeriodPresets.find(
                (preset) => String(preset) === value,
              );
              if (days === undefined) return;
              setCustomOpen(false);
              go(withFunnelPeriod(query, { kind: "preset", days }));
            },
            options: [
              ...funnelPeriodPresets.map((days) => ({
                label: presetLabel(days),
                value: String(days),
              })),
              { label: "Свой период", value: customValue },
            ],
            value:
              customOpen || view.preset === null
                ? customValue
                : String(view.preset),
          },
        ]}
        onReset={
          isDefault
            ? undefined
            : () => {
                setCustomOpen(false);
                router.push(
                  salesFunnelHref({
                    productId: null,
                    chapterId: null,
                    period: { kind: "preset", days: defaultFunnelPeriodPreset },
                  }),
                );
              }
        }
      />
      {customOpen ? (
        <form
          aria-label="Свой период"
          className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-start"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValidCustomPeriod(from, to)) {
              setPeriodError(
                "Укажите обе даты. Дата начала не может быть позже даты окончания.",
              );
              return;
            }
            setPeriodError("");
            go(withFunnelPeriod(query, { kind: "custom", from, to }));
          }}
        >
          <DateField label="С" onChange={setFrom} required value={from} />
          <DateField
            error={periodError}
            label="По"
            onChange={setTo}
            required
            value={to}
          />
          <Button className="min-h-11 px-4 sm:mt-7" type="submit">
            Показать
          </Button>
        </form>
      ) : null}
    </div>
  );
}
