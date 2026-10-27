import { z } from "zod";

/**
 * Продукты, которые владелец может выдать или выбрать в фильтре людей (#1721). Каталог читается
 * из справочника авторских ссылок: в нём все продукты, включая архивные. Это список выбора, а не
 * правило доступа: выдачу всё равно решает Product Access.
 */
export const accessProductSchema = z
  .object({ archived: z.boolean(), productId: z.uuid(), name: z.string() })
  .strict();

export type AccessProduct = z.infer<typeof accessProductSchema>;

export type AccessProductCatalog =
  | { readonly kind: "ready"; readonly products: readonly AccessProduct[] }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const accessProductCatalogSchema: z.ZodType<AccessProductCatalog> =
  z.union([
    z
      .object({
        kind: z.literal("ready"),
        products: z.array(accessProductSchema),
      })
      .strict(),
    z.object({ kind: z.literal("signed_out") }).strict(),
    z.object({ kind: z.literal("forbidden") }).strict(),
    z
      .object({ kind: z.literal("unavailable"), reference: z.string() })
      .strict(),
  ]);

/** Вне префикса людей: запись доступа меняет людей, но не каталог продуктов. */
export const accessProductCatalogQueryKey = [
  "authoring",
  "access-product-catalog",
] as const;

/** Выбор каталога в порядке показа: действующие по алфавиту, затем архивные. */
export function sortAccessProducts(
  products: readonly AccessProduct[],
): readonly AccessProduct[] {
  return [...products].sort((left, right) =>
    left.archived === right.archived
      ? left.name.localeCompare(right.name, "ru")
      : left.archived
        ? 1
        : -1,
  );
}

/** Подпись продукта в выборе: архивный говорит об этом сам. */
export function accessProductLabel(product: AccessProduct): string {
  return product.archived ? `${product.name} (в архиве)` : product.name;
}
