import { BillingDisclosure } from "./billing-disclosure.client";
import { productCapability } from "@inside/access-capabilities";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import {
  accessSourceLabel,
  formatBillingDate,
  type AccessGround,
} from "@/entities/subscription";

export function ProductAccessList({
  grounds,
}: {
  readonly grounds: readonly AccessGround[];
}) {
  const products = [
    ...new Map(
      grounds.flatMap((ground) =>
        (ground.content ?? [])
          .filter((entry) => entry.kind === "product")
          .map((entry) => [entry.id, entry] as const),
      ),
    ).values(),
  ];
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="current-products">
      <h2 id="current-products" className="text-xl font-semibold">
        Ваши продукты
      </h2>
      <ul className="mt-4 grid gap-4">
        {products.map((product) => {
          const bases = grounds.filter(
            (ground) =>
              ground.content?.some((entry) => entry.id === product.id) === true,
          );
          const access = bases.some(
            (ground) =>
              ground.active &&
              ground.capabilities.some(
                (capability) =>
                  capability === "materials" ||
                  capability === productCapability(product.id),
              ),
          );
          const support = bases.filter(
            (ground) =>
              ground.active && ground.capabilities.includes("support"),
          );
          return (
            <li
              key={product.id}
              className="rounded-2xl border border-border bg-card p-5 sm:p-7"
            >
              <h3 className="text-xl font-semibold">{product.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {access ? "Доступ открыт" : "Доступ ещё не начался"}
              </p>
              {product.slug === null || !access ? null : (
                <Button asChild className="mt-5">
                  <Link href={productProgrammeHref(product.slug)}>
                    Открыть продукт
                  </Link>
                </Button>
              )}
              {support.length === 0 ? null : (
                <p className="mt-3 text-sm">
                  Сопровождение{" "}
                  {support.some((ground) => ground.validUntil === null)
                    ? "без даты окончания"
                    : `до ${formatBillingDate(
                        support
                          .map((ground) => ground.validUntil ?? "")
                          .sort()
                          .at(-1) ?? "",
                      )}`}
                  .
                </p>
              )}
              <BillingDisclosure title="Доступ и сроки">
                <ul className="grid gap-2">
                  {bases.map((ground, index) => (
                    <li key={index}>
                      {accessSourceLabel(ground.source)}:{" "}
                      {ground.capabilities.includes("support")
                        ? "сопровождение"
                        : ground.capabilities.includes("community")
                          ? "сообщество продукта"
                          : "материалы продукта"}
                      {ground.validUntil === null
                        ? " без даты окончания"
                        : ` до ${formatBillingDate(ground.validUntil)}`}
                      .
                    </li>
                  ))}
                </ul>
              </BillingDisclosure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
