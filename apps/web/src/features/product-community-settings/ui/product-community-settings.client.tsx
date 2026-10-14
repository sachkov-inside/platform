"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { billingErrorMessage } from "@/entities/subscription";
import {
  configureProductCommunity,
  readProductCommunityConfiguration,
} from "../api/configuration.browser";
export function ProductCommunitySettings({
  productId,
  onSaved,
}: {
  readonly productId: string;
  readonly onSaved: () => void;
}) {
  const query = useQuery({
    queryKey: ["authoring", "product-community", productId],
    queryFn: () => readProductCommunityConfiguration(productId),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: configureProductCommunity,
    retry: false,
    onSuccess: async (result) => {
      if (!result.ok) return;
      await query.refetch();
      onSaved();
    },
  });
  const result = query.data;
  if (query.data?.ok === false && query.data.code === "forbidden") return null;
  const connected = result?.ok === true && result.value.groupRef === "primary";
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5"
      aria-labelledby={`product-community-${productId}`}
    >
      <h2
        className="text-xl font-semibold"
        id={`product-community-${productId}`}
      >
        Группа Telegram
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Привязка группы не выдаёт доступ. Участие должно входить в права
        продукта.
      </p>
      {query.isPending ? (
        <p className="mt-3" role="status">
          Загружаем группу…
        </p>
      ) : result?.ok === false || query.isError ? (
        <p className="mt-3" role="alert">
          Не удалось загрузить группу.
        </p>
      ) : (
        <Button
          className="mt-4"
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => {
            mutation.mutate({
              productId,
              groupRef: connected ? null : "primary",
            });
          }}
        >
          {connected ? "Отвязать текущую группу" : "Привязать текущую группу"}
        </Button>
      )}
      {mutation.data?.ok === false ? (
        <p className="mt-3" role="alert">
          {billingErrorMessage(mutation.data.code)}
        </p>
      ) : null}
      {connected ? (
        <p className="mt-3 text-sm" role="status">
          Текущая группа Telegram привязана.
        </p>
      ) : null}
    </section>
  );
}
