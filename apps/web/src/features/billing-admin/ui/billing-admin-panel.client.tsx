"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  billingErrorMessage,
  formatKopecks,
  type BillingCommandResult,
  type PriceSnapshot,
  type ProductSalesState,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { WorkspaceTabs } from "@/shared/ui/workspace-tabs.client";
import {
  saveProductPriceOperation,
  archiveProductPriceOperation,
} from "../api/product-prices.operation";
import {
  readOwnerBillingCatalog,
  listBillingPayments,
  readBillingPayment,
  reconcileBillingPayment,
  readBillingRefunds,
  saveBillingCohort,
} from "../api/billing-admin.browser";
import { readContentCatalog } from "../api/enrollments.browser";
import type {
  ListPaymentsInput,
  PaymentView,
  PaymentOutcome,
  RefundsOutcome,
} from "../model/admin-operations";
import { BillingAdminFrame } from "./billing-admin-frame";
import { AdminField, AdminSection, formText } from "./admin-form.client";
import { PaymentsSection } from "./payments-section.client";
import { PaymentLinksPanel } from "./payment-links-panel.client";
import { ProductPromotionsPanel } from "./product-promotions-panel.client";
import { ActivationRulesPanel } from "./activation-rules-panel.client";
import { SurveyRespondentsPanel } from "./survey-respondents-panel.client";
import { CohortSection } from "./cohort-section.client";

export interface BillingAdminPanelProps {
  readonly offers: readonly PriceSnapshot[];
  readonly cohorts: readonly ProductSalesState[] | null;
}
export function BillingAdminPanel({
  offers,
  cohorts: initialCohorts,
}: BillingAdminPanelProps) {
  const [catalog, setCatalog] = useState(offers);
  const [cohorts, setCohorts] = useState(initialCohorts);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [payments, setPayments] = useState<readonly PaymentView[]>([]);
  const [payment, setPayment] = useState<PaymentOutcome["result"] | null>(null);
  const [refunds, setRefunds] = useState<RefundsOutcome["result"] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<Omit<
    ListPaymentsInput,
    "operationId"
  > | null>(null);
  const repeat = useRepeatableOperations();
  const content = useQuery({
    queryKey: ["owner-content"],
    queryFn: async () => {
      const result = await readContentCatalog();
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result.items;
    },
  });
  const command = useMutation({
    mutationFn: async (run: () => Promise<void>) => run(),
    retry: false,
    onError: () => {
      setError("Ответ потерян. Повторите то же действие.");
    },
  });
  function dispatch<T>(
    run: () => Promise<BillingCommandResult<T>>,
    apply: (value: T) => void,
  ) {
    setError(undefined);
    setNotice(undefined);
    command.mutate(async () => {
      const result = await run();
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      apply(result.value);
      setNotice("Изменения сохранены.");
    });
  }
  async function refresh() {
    const result = await readOwnerBillingCatalog();
    if (!result.ok) {
      setError(billingErrorMessage(result.code));
      return;
    }
    setCatalog(result.value);
  }
  const pricing = (
    <>
      <AdminSection
        title="Цены продуктов"
        description="Одна разовая цена продукта. Закрытие продаж и архив не отзывают купленный доступ."
      >
        <Button
          className="min-h-11"
          variant="outline"
          disabled={command.isPending}
          onClick={() => {
            command.mutate(refresh);
          }}
        >
          Обновить каталог
        </Button>
        {catalog.map((snapshot) => {
          const product = snapshot.product;
          if (!product) return null;
          return (
            <form
              className="grid gap-3 border-b border-border pb-5"
              key={product.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const input = {
                  expectedRevision: product.priceRevision,
                  value: {
                    productId: product.id,
                    name: formText(form.get("name")),
                    priceKopecks: Number(form.get("price")),
                    published: form.get("published") === "on",
                  },
                };
                dispatch(
                  () =>
                    saveProductPriceOperation.send({
                      ...input,
                      operationId: repeat.operationId(
                        `price:${product.id}`,
                        input,
                      ),
                    }),
                  () => {
                    repeat.completeOperation(`price:${product.id}`);
                    void refresh();
                  },
                );
              }}
            >
              <h3 className="font-semibold">
                {product.name} ·{" "}
                {formatKopecks(snapshot.paymentOption.priceKopecks)}
              </h3>
              <AdminField
                label="Название продукта"
                name="name"
                defaultValue={product.name}
                required
                maxLength={200}
              />
              <AdminField
                label="Цена в копейках"
                name="price"
                type="number"
                min={100}
                step={1}
                defaultValue={snapshot.paymentOption.priceKopecks}
                required
              />
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={snapshot.offer.published ?? false}
                />
                Продажа открыта
              </label>
              <div className="flex flex-wrap gap-3">
                <Button
                  className="min-h-11"
                  disabled={command.isPending || snapshot.offer.archived}
                  type="submit"
                >
                  Сохранить цену
                </Button>
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={command.isPending || snapshot.offer.archived}
                  onClick={() => {
                    const input = {
                      id: product.id,
                      expectedRevision: product.priceRevision,
                    };
                    dispatch(
                      () =>
                        archiveProductPriceOperation.send({
                          ...input,
                          operationId: repeat.operationId(
                            `archive:${product.id}`,
                            input,
                          ),
                        }),
                      () => {
                        void refresh();
                      },
                    );
                  }}
                >
                  Архивировать цену
                </Button>
              </div>
            </form>
          );
        })}
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const input = {
              value: {
                productId: formText(form.get("productId")),
                name: formText(form.get("name")),
                priceKopecks: Number(form.get("price")),
                published: false,
              },
            };
            dispatch(
              () =>
                saveProductPriceOperation.send({
                  ...input,
                  operationId: repeat.operationId("new-price", input),
                }),
              () => {
                repeat.completeOperation("new-price");
                void refresh();
              },
            );
          }}
        >
          <h3 className="font-semibold">Добавить цену продукта</h3>
          <AdminField
            label="Идентификатор продукта"
            name="productId"
            required
          />
          <AdminField label="Название" name="name" required />
          <AdminField
            label="Цена в копейках"
            name="price"
            type="number"
            min={100}
            step={1}
            required
          />
          <Button
            className="min-h-11"
            type="submit"
            disabled={command.isPending}
          >
            Сохранить без открытия продаж
          </Button>
        </form>
      </AdminSection>
      <CohortSection
        cohorts={cohorts}
        content={content.data}
        pending={command.isPending}
        onSaveCohort={(input) => {
          dispatch(
            () =>
              saveBillingCohort({
                ...input,
                operationId: repeat.operationId("cohort", input),
              }),
            (value) => {
              repeat.completeOperation("cohort");
              const saved = {
                ...input.value,
                revision: value.result.value.revision,
              };
              setCohorts((current) => [
                ...(current ?? []).filter(
                  (item) => item.productId !== saved.productId,
                ),
                saved,
              ]);
            },
          );
        }}
      />
    </>
  );
  return (
    <BillingAdminFrame>
      <header className="authoring-page-heading">
        <h1>Оплата</h1>
        <p>Цены продуктов, разовые покупки и банковская история.</p>
      </header>
      {error !== undefined || content.isError ? (
        <p role="alert">{error ?? content.error?.message}</p>
      ) : null}
      {notice !== undefined ? <p role="status">{notice}</p> : null}
      <WorkspaceTabs
        label="Разделы оплаты"
        tabs={[
          { id: "prices", label: "Цены продуктов", panel: pricing },
          {
            id: "promotions",
            label: "Скидки",
            panel: <ProductPromotionsPanel offers={catalog} />,
          },
          {
            id: "payments",
            label: "Платежи",
            panel: (
              <PaymentsSection
                payments={payments}
                paymentsCursor={cursor}
                paymentsFilters={filters}
                payment={payment}
                refunds={refunds}
                pending={command.isPending}
                onListPayments={(input) => {
                  dispatch(
                    () =>
                      listBillingPayments({
                        ...input,
                        operationId: repeat.operationId("payments", input),
                      }),
                    (value) => {
                      setPayments(value.result.items);
                      setCursor(value.result.nextCursor);
                      setFilters(input);
                    },
                  );
                }}
                onReadPayment={(input) => {
                  dispatch(
                    () =>
                      readBillingPayment({
                        ...input,
                        operationId: repeat.operationId("read-payment", input),
                      }),
                    (value) => {
                      setPayment(value.result);
                    },
                  );
                }}
                onReadRefunds={(input) => {
                  dispatch(
                    () =>
                      readBillingRefunds({
                        ...input,
                        operationId: repeat.operationId("refunds", input),
                      }),
                    (value) => {
                      setRefunds(value.result);
                    },
                  );
                }}
                onReconcilePayment={(input) => {
                  dispatch(
                    () =>
                      reconcileBillingPayment({
                        ...input,
                        operationId: repeat.operationId("reconcile", input),
                      }),
                    (value) => {
                      setPayment((current) =>
                        current
                          ? { ...current, value: value.result.value }
                          : null,
                      );
                    },
                  );
                }}
              />
            ),
          },
          {
            id: "links",
            label: "Личные ссылки",
            panel: (
              <PaymentLinksPanel
                offers={catalog}
                content={content.data ?? []}
              />
            ),
          },
          {
            id: "activation",
            label: "Активация курса",
            panel: <ActivationRulesPanel offers={catalog} />,
          },
          {
            id: "respondents",
            label: "Ответы на опрос",
            panel: <SurveyRespondentsPanel />,
          },
        ]}
      />
    </BillingAdminFrame>
  );
}
