"use client";
import { useQuery } from "@tanstack/react-query";
import { readProductCommunityConfiguration } from "../api/configuration.browser";

/** Product rights include the fixed current community; this is a read-only owner fact. */
export function ProductCommunitySettings({
  productId,
}: {
  readonly productId: string;
  /** Retained caller shape while old configuration clients migrate (#1712). */
  readonly onSaved: () => void;
}) {
  const query = useQuery({
    queryKey: ["authoring", "product-community", productId],
    queryFn: () => readProductCommunityConfiguration(productId),
    retry: false,
  });
  const result = query.data;
  if (result?.ok === false && result.code === "forbidden") return null;
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5"
      aria-labelledby={`product-community-${productId}`}
    >
      <h2
        className="text-xl font-semibold"
        id={`product-community-${productId}`}
      >
        Общая группа Telegram
      </h2>
      {query.isPending ? (
        <p className="mt-3" role="status">
          Загружаем группу…
        </p>
      ) : result?.ok === false || query.isError ? (
        <p className="mt-3" role="alert">
          Не удалось загрузить группу.
        </p>
      ) : (
        <p className="mt-3 text-sm" role="status">
          Все продукты используют общую группу Telegram.
        </p>
      )}
    </section>
  );
}
