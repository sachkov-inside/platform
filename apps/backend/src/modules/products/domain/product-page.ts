import { z } from "zod";

/**
 * Описание страницы продукта, перенесённое из авторского `product.yaml` (ADR 0026). Platform хранит
 * его как данные Product и не пишет сама: менять его может только source-scoped импорт.
 */

/** Реестр оформлений. Web держит компоненты для каждого значения; новое значение добавляется в оба. */
export const productPresentations = [
  "default",
  "ai-first-process",
  "ai-engineering-course",
] as const;
export const productPresentationSchema = z.enum(productPresentations);
export type ProductPresentation = z.infer<typeof productPresentationSchema>;

const PRODUCT_PAGE_SHORT_MAX = 200;
const PRODUCT_PAGE_LONG_MAX = 4000;
const PRODUCT_PAGE_BLOCKS_MAX = 16;
const PRODUCT_PAGE_ITEMS_MAX = 12;

/** Сроки оферты подставляет web; другие подстановки автор писать не может. */
export const productPageTerms = ["access_term", "support_term"] as const;

/** Подстановкой считается только `{известное_имя}`: одиночная скобка остаётся обычным символом. */
const placeholders = /\{([a-z_]+)\}/gu;
function onlyKnownTerms(value: string): boolean {
  return [...value.matchAll(placeholders)].every(([, name]) =>
    (productPageTerms as readonly string[]).includes(name ?? ""),
  );
}

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value === value.trim(), "Expected trimmed text")
    .refine(
      onlyKnownTerms,
      `Only {${productPageTerms.join("}, {")}} may be substituted`,
    );
const short = text(PRODUCT_PAGE_SHORT_MAX);
const long = text(PRODUCT_PAGE_LONG_MAX);
const requiredShort = short.pipe(z.string().min(1));
const requiredLong = long.pipe(z.string().min(1));
const list = <T extends z.ZodType>(item: T, min = 1) =>
  z.array(item).min(min).max(PRODUCT_PAGE_ITEMS_MAX);
const blockId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);

const block = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({ id: blockId, kind: z.literal(kind), ...shape }).strict();

const heroBlock = block("hero", {
  // Короткая метка рядом с названием; описания, перенесённые до её появления, читаются без неё.
  badge: short.default(""),
  lead: requiredLong,
  highlights: list(requiredShort, 0),
});

export const productPageBlockSchema = z.discriminatedUnion("kind", [
  heroBlock,
  block("cards", {
    eyebrow: short,
    title: requiredShort,
    lead: long,
    items: list(
      z
        .object({
          title: requiredShort,
          text: requiredLong,
          detailLabel: short,
          detail: short,
        })
        .strict()
        // Подпись без значения нечего показать, поэтому её не принимают вместо тихой потери.
        .refine(
          ({ detail, detailLabel }) => detailLabel === "" || detail !== "",
          { path: ["detail"] },
        ),
    ),
    note: long,
  }),
  block("text", { title: requiredShort, paragraphs: list(requiredLong) }),
  block("steps", {
    title: requiredShort,
    lead: long,
    items: list(
      z.object({ title: requiredShort, text: requiredLong }).strict(),
    ),
    link: short,
  }),
  block("list", {
    title: requiredShort,
    text: long,
    items: list(requiredShort),
  }),
  block("trial", { title: requiredShort, text: requiredLong, link: short }),
]);

/** Первый экран продукта для карточки Главной: поля блока `hero` без его `id` и вида. */
export const productPageHeroSchema = heroBlock.omit({ id: true, kind: true });
export type ProductPageHero = z.infer<typeof productPageHeroSchema>;

/** Вводный блок описания, если он есть: одна запись, без второй копии текста. */
export function productPageHero(
  page: ProductPage | null,
): ProductPageHero | null {
  const hero = page?.blocks.find((block) => block.kind === "hero");
  return hero?.kind === "hero"
    ? { badge: hero.badge, lead: hero.lead, highlights: hero.highlights }
    : null;
}

export const productPageCardSchema = z
  .object({ eyebrow: short, subtitle: short, action: short })
  .strict();

/** Описание целиком остаётся обозримым: это страница продукта, а не хранилище текстов. */
const PRODUCT_PAGE_BYTES_MAX = 32 * 1024;

export const productPageSchema = z
  .object({
    card: productPageCardSchema.nullable().default(null),
    blocks: z.array(productPageBlockSchema).min(1).max(PRODUCT_PAGE_BLOCKS_MAX),
  })
  .strict()
  .refine(
    ({ blocks }) => new Set(blocks.map(({ id }) => id)).size === blocks.length,
    { path: ["blocks"], message: "Block ids must be unique" },
  )
  // Заголовок страницы один, поэтому вводный блок тоже один.
  .refine(
    ({ blocks }) => blocks.filter(({ kind }) => kind === "hero").length <= 1,
    { path: ["blocks"], message: "A page has at most one hero block" },
  )
  .refine(
    (page) =>
      new TextEncoder().encode(JSON.stringify(page)).length <=
      PRODUCT_PAGE_BYTES_MAX,
    {
      message: `A page description must stay under ${String(PRODUCT_PAGE_BYTES_MAX)} bytes`,
    },
  );

export type ProductPageCard = z.infer<typeof productPageCardSchema>;
export type ProductPageBlock = z.infer<typeof productPageBlockSchema>;

/** Поля Product, которые пишет только перенос из авторского оригинала. */
export interface ProductSourceFields {
  readonly page: ProductPage | null;
  readonly presentation: ProductPresentation;
  readonly slug: string;
}
export type ProductPage = z.infer<typeof productPageSchema>;

/** Сохранённое описание читается как внешнее значение: неверное не показывается. */
export function readStoredProductPage(
  value: unknown,
): ProductPage | null | "invalid" {
  if (value === null) return null;
  const parsed = productPageSchema.safeParse(value);
  return parsed.success ? parsed.data : "invalid";
}
