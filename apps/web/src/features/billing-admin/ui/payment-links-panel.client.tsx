"use client";
import {
  isProductCapability,
  productIdFromCapability,
  type coverageEntrySchema,
} from "@inside/access-capabilities";
import type { z } from "zod";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  billingErrorMessage,
  type PaymentLink,
  type PriceSnapshot,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import {
  createPaymentLink,
  listPaymentLinks,
  revokePaymentLink,
} from "../api/payment-links.browser";
import type { CreatePaymentLinkInput } from "../model/payment-link-operations";
import { PaymentLinksView } from "./payment-links-view.client";
const key = ["owner-payment-links"];
export function PaymentLinksPanel({
  offers,
  content,
}: {
  readonly offers: readonly PriceSnapshot[];
  readonly content: readonly z.infer<typeof coverageEntrySchema>[];
}) {
  const cache = useQueryClient();
  const { operationId, completeOperation } = useRepeatableOperations();
  const [issued, setIssued] = useState<PaymentLink | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listPaymentLinks({
        operationId: crypto.randomUUID(),
        limit: 50,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: key });
  };
  function lost() {
    setError(
      "Ответ не получен. Повторите то же действие: повтор не создаст вторую ссылку.",
    );
  }
  const creating = useMutation({
    mutationFn: createPaymentLink,
    retry: false,
    onError: lost,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      completeOperation("create");
      setError(undefined);
      setIssued(result.value.result.value);
      setMessage("Отправьте ссылку покупателю самостоятельно.");
      refresh();
    },
  });
  const revoking = useMutation({
    mutationFn: revokePaymentLink,
    retry: false,
    onError: lost,
    onSuccess: (result, input) => {
      if (!result.ok) {
        setError(
          result.code === "reservation_conflict"
            ? "По ссылке уже началась оплата. Дождитесь результата банка."
            : billingErrorMessage(result.code),
        );
        refresh();
        return;
      }
      completeOperation(`revoke:${input.id}`);
      setError(undefined);
      setMessage("Ссылка отозвана.");
      refresh();
    },
  });
  function create(input: Omit<CreatePaymentLinkInput, "operationId">) {
    setError(undefined);
    creating.mutate({ ...input, operationId: operationId("create", input) });
  }
  const eligible = offers.filter(
    (snapshot) =>
      snapshot.paymentOption.mode === "one_time" &&
      !snapshot.paymentOption.archived &&
      !snapshot.offer.archived &&
      snapshot.offer.benefits.filter(isProductCapability).length === 1,
  );
  function titleFor(snapshot: PriceSnapshot) {
    const capability = snapshot.offer.benefits.find(isProductCapability);
    const id =
      capability === undefined ? null : productIdFromCapability(capability);
    return (
      content.find((entry) => entry.kind === "product" && entry.id === id)
        ?.title ?? snapshot.offer.name
    );
  }
  return (
    <PaymentLinksView
      offers={eligible}
      titleFor={titleFor}
      links={list.data?.pages.flatMap((page) => page.items) ?? []}
      issued={issued}
      loading={list.isFetching}
      pending={creating.isPending || revoking.isPending}
      error={
        error ??
        (list.isError
          ? "Не удалось загрузить ссылки. Обновите список."
          : undefined)
      }
      message={message}
      hasNext={list.hasNextPage}
      onCreate={create}
      onRefresh={refresh}
      onMore={() => {
        void list.fetchNextPage();
      }}
      onRevoke={(link) => {
        const input = { id: link.id, expectedRevision: link.revision };
        revoking.mutate({
          ...input,
          operationId: operationId(`revoke:${link.id}`, input),
        });
      }}
    />
  );
}
