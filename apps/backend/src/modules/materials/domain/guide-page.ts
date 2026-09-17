import { z } from "zod";

/**
 * Описание страницы продукта, перенесённое из авторского `guide.yaml` (ADR 0026). Platform хранит
 * его как данные Guide и не пишет сама: менять его может только source-scoped импорт.
 */

/** Реестр оформлений. Web держит компоненты для каждого значения; новое значение добавляется в оба. */
export const guidePresentations = ["default", "ai-first-process"] as const;
export const guidePresentationSchema = z.enum(guidePresentations);
export type GuidePresentation = z.infer<typeof guidePresentationSchema>;

export const GUIDE_PAGE_SHORT_MAX = 200;
export const GUIDE_PAGE_LONG_MAX = 4000;
export const GUIDE_PAGE_BLOCKS_MAX = 16;
export const GUIDE_PAGE_ITEMS_MAX = 12;

/** Сроки оферты подставляет web; другие подстановки автор писать не может. */
export const guidePageTerms = ["access_term", "support_term"] as const;

/** Подстановкой считается только `{известное_имя}`: одиночная скобка остаётся обычным символом. */
const placeholders = /\{([a-z_]+)\}/gu;
function onlyKnownTerms(value: string): boolean {
  return [...value.matchAll(placeholders)].every(([, name]) => (guidePageTerms as readonly string[]).includes(name ?? ""));
}

const text = (max: number) => z.string().max(max).refine((value) => value === value.trim(), "Expected trimmed text").refine(onlyKnownTerms, `Only {${guidePageTerms.join("}, {")}} may be substituted`);
const short = text(GUIDE_PAGE_SHORT_MAX);
const long = text(GUIDE_PAGE_LONG_MAX);
const requiredShort = short.pipe(z.string().min(1));
const requiredLong = long.pipe(z.string().min(1));
const list = <T extends z.ZodType>(item: T, min = 1) => z.array(item).min(min).max(GUIDE_PAGE_ITEMS_MAX);
const blockId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);

const block = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({ id: blockId, kind: z.literal(kind), ...shape }).strict();

export const guidePageBlockSchema = z.discriminatedUnion("kind", [
  block("hero", { lead: requiredLong, highlights: list(requiredShort, 0) }),
  block("cards", {
    eyebrow: short,
    title: requiredShort,
    lead: long,
    items: list(z.object({ title: requiredShort, text: requiredLong, detailLabel: short, detail: short }).strict()),
    note: long,
  }),
  block("text", { title: requiredShort, paragraphs: list(requiredLong) }),
  block("steps", { title: requiredShort, lead: long, items: list(z.object({ title: requiredShort, text: requiredLong }).strict()), link: short }),
  block("list", { title: requiredShort, text: long, items: list(requiredShort) }),
  block("trial", { title: requiredShort, text: requiredLong, link: short }),
]);

export const guidePageCardSchema = z.object({ eyebrow: short, subtitle: short, action: short }).strict();

/** Описание целиком остаётся обозримым: это страница продукта, а не хранилище текстов. */
export const GUIDE_PAGE_BYTES_MAX = 32 * 1024;

export const guidePageSchema = z
  .object({
    card: guidePageCardSchema.nullable().default(null),
    blocks: z.array(guidePageBlockSchema).min(1).max(GUIDE_PAGE_BLOCKS_MAX),
  })
  .strict()
  .refine(({ blocks }) => new Set(blocks.map(({ id }) => id)).size === blocks.length, { path: ["blocks"], message: "Block ids must be unique" })
  // Заголовок страницы один, поэтому вводный блок тоже один.
  .refine(({ blocks }) => blocks.filter(({ kind }) => kind === "hero").length <= 1, { path: ["blocks"], message: "A page has at most one hero block" })
  .refine((page) => new TextEncoder().encode(JSON.stringify(page)).length <= GUIDE_PAGE_BYTES_MAX, { message: `A page description must stay under ${String(GUIDE_PAGE_BYTES_MAX)} bytes` });

export type GuidePageCard = z.infer<typeof guidePageCardSchema>;
export type GuidePageBlock = z.infer<typeof guidePageBlockSchema>;

/** Поля Guide, которые пишет только перенос из авторского оригинала. */
export interface GuideSourceFields {
  readonly page: GuidePage | null;
  readonly presentation: GuidePresentation;
  readonly slug: string;
}
export type GuidePage = z.infer<typeof guidePageSchema>;

/** Сохранённое описание читается как внешнее значение: неверное не показывается. */
export function readStoredGuidePage(value: unknown): GuidePage | null | "invalid" {
  if (value === null) return null;
  const parsed = guidePageSchema.safeParse(value);
  return parsed.success ? parsed.data : "invalid";
}
