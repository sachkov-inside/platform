"use client";

/** Product rights include the fixed current community; this is a read-only owner fact. */
export function ProductCommunitySettings({
  productId,
}: {
  readonly productId: string;
}) {
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
      <p className="mt-3 text-sm" role="status">
        Все продукты используют общую группу Telegram.
      </p>
    </section>
  );
}
