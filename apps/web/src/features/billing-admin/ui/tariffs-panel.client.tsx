"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  billingErrorMessage,
  type BillingCommandResult,
  type BillingFailureCode,
  type BillingOffer,
  type PriceSnapshot,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  publishBillingOffer,
  saveBillingOffer,
  unpublishBillingOffer,
} from "../api/billing-admin.browser";
import { eligibilitySave, tariffRows } from "../model/access-operations";
import type { CatalogOutcome } from "../model/admin-operations";
import { TariffsView } from "./tariffs-view.client";

/** Отказы каталога словами владельца. */
const tariffMessages: Partial<Record<BillingFailureCode, string>> = {
  revision_conflict:
    "Тариф изменился в другом окне. Обновите страницу и повторите.",
  invalid_request:
    "Этот тариф нельзя продавать: у него нет состава доступа или он выдаёт только отдельный материал.",
  method_unavailable:
    "Оплата не настроена: без терминала и адреса для чеков продажу не включить.",
  not_found: "Тариф не найден или уже в архиве. Обновите страницу.",
};

interface TariffChange {
  readonly offerId: string;
  readonly patch: Partial<BillingOffer>;
  readonly message: string;
  readonly run: () => Promise<BillingCommandResult<CatalogOutcome>>;
}

export function TariffsPanel({
  offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
  const { operationId, completeOperation } = useRepeatableOperations();
  // Каталог читается страницей один раз; после команды обновляются ревизия и изменённый признак.
  const [catalog, setCatalog] = useState(offers);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const change = useMutation({
    retry: false,
    mutationFn: async (task: TariffChange) => ({
      task,
      result: await task.run(),
    }),
    onError: () => {
      setFailure("Ответ не получен. Повторите то же действие.");
    },
    onSuccess: ({ task, result }) => {
      if (!result.ok) {
        setMessage("");
        setFailure(
          tariffMessages[result.code] ?? billingErrorMessage(result.code),
        );
        return;
      }
      completeOperation(task.offerId);
      const { revision, published } = result.value.result.value;
      setCatalog((current) =>
        current.map((snapshot) =>
          snapshot.offer.id === task.offerId
            ? {
                ...snapshot,
                offer: {
                  ...snapshot.offer,
                  ...task.patch,
                  revision,
                  ...(published === undefined ? {} : { published }),
                },
              }
            : snapshot,
        ),
      );
      setFailure(null);
      setMessage(task.message);
    },
  });
  return (
    <TariffsView
      busy={change.isPending}
      failure={failure}
      message={message}
      onSaveEligibility={(row, eligibility) => {
        const input = eligibilitySave(row.offer, eligibility);
        change.mutate({
          offerId: row.offer.id,
          patch: { eligibility },
          message:
            eligibility === "invitation_only"
              ? `«${row.offer.name}» продаётся только по приглашению.`
              : `«${row.offer.name}»: допуск сохранён.`,
          run: () =>
            saveBillingOffer({
              ...input,
              operationId: operationId(row.offer.id, input),
            }),
        });
      }}
      onToggleSale={(row, published) => {
        const input = {
          id: row.offer.id,
          expectedRevision: row.offer.revision,
        };
        change.mutate({
          offerId: row.offer.id,
          patch: {},
          message: published
            ? `«${row.offer.name}» включён в продажу.`
            : `«${row.offer.name}» снят с продажи. Выданный доступ сохранён.`,
          run: () =>
            (published ? publishBillingOffer : unpublishBillingOffer)({
              ...input,
              operationId: operationId(row.offer.id, { ...input, published }),
            }),
        });
      }}
      tariffs={tariffRows(catalog)}
    />
  );
}
