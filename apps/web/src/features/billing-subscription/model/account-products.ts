import { productCapability } from "@inside/access-capabilities";
import type { AccessGround, OwnPayment } from "@/entities/subscription";

type Product = NonNullable<AccessGround["content"]>[number];

/** Merge the two existing account projections without treating a grant as a purchase. */
export function accountProducts(
  grounds: readonly AccessGround[],
  payments: readonly OwnPayment[],
) {
  const purchases = payments.filter((payment) => payment.kind === "one_time");
  const products = new Map<string, Product>();
  for (const source of [...grounds, ...purchases])
    for (const entry of source.content ?? [])
      if (entry.kind === "product" && !products.has(entry.id))
        products.set(entry.id, entry);

  return [...products.values()].map((product) => {
    const bases = grounds.filter(
      (ground) =>
        ground.content?.some(
          (entry) => entry.kind === "product" && entry.id === product.id,
        ) === true,
    );
    const history = purchases
      .filter(
        (payment) =>
          payment.content?.some(
            (entry) => entry.kind === "product" && entry.id === product.id,
          ) === true,
      )
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    const payment =
      history.find(
        (item) =>
          item.state === "confirmed" &&
          item.refundedKopecks < item.amountKopecks,
      ) ?? history[0];
    const granted = bases.some(
      (ground) =>
        ground.active &&
        ground.capabilities.some(
          (capability) =>
            capability === "materials" ||
            capability === productCapability(product.id),
        ),
    );
    const paymentAccess =
      payment?.productAccess?.find((entry) => entry.productId === product.id)
        ?.access ?? payment?.access;
    return {
      product,
      bases,
      history,
      payment,
      access: granted ? ("ready" as const) : paymentAccess,
    };
  });
}
