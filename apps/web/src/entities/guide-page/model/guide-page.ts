import { z } from "zod";

/**
 * Описание страницы продукта из авторского оригинала (ADR 0026). Backend проверяет его при
 * переносе; web читает ответ как внешнее значение и сам решает, чем его нарисовать.
 */

/** Оформления, которые умеет рисовать этот web. Страница и карточка Главной держат карту по ним. */
export const guidePresentations = [
  "default",
  "ai-first-process",
  "ai-engineering-course",
] as const;
export type GuidePresentation = (typeof guidePresentations)[number];

const cardItemSchema = z
  .object({
    title: z.string(),
    text: z.string(),
    detailLabel: z.string(),
    detail: z.string(),
  })
  .strict();
const stepSchema = z.object({ title: z.string(), text: z.string() }).strict();
const heroBlockSchema = z
  .object({
    id: z.string(),
    kind: z.literal("hero"),
    badge: z.string().default(""),
    lead: z.string(),
    highlights: z.array(z.string()),
  })
  .strict();
const blockSchema = z.discriminatedUnion("kind", [
  heroBlockSchema,
  z
    .object({
      id: z.string(),
      kind: z.literal("cards"),
      eyebrow: z.string(),
      title: z.string(),
      lead: z.string(),
      items: z.array(cardItemSchema),
      note: z.string(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("text"),
      title: z.string(),
      paragraphs: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("steps"),
      title: z.string(),
      lead: z.string(),
      items: z.array(stepSchema),
      link: z.string(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("list"),
      title: z.string(),
      text: z.string(),
      items: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("trial"),
      title: z.string(),
      text: z.string(),
      link: z.string(),
    })
    .strict(),
]);
const cardSchema = z
  .object({ eyebrow: z.string(), subtitle: z.string(), action: z.string() })
  .strict();
export const guidePageSchema = z
  .object({ card: cardSchema.nullable(), blocks: z.array(blockSchema) })
  .strict();

export type GuidePage = z.infer<typeof guidePageSchema>;
export type GuidePageBlock = GuidePage["blocks"][number];

/**
 * Подставляет сроки предложения во все тексты описания: автор пишет `{access_term}` и `{support_term}`,
 * а оформление получает готовый текст и не пропускает ни одного поля (ADR 0026).
 */
export function fillGuidePage(
  page: GuidePage,
  fill: (text: string) => string,
): GuidePage {
  return {
    ...page,
    blocks: page.blocks.map((block) => fillBlock(block, fill)),
  };
}

/** Подпись Главной берёт те же поля, что первый экран страницы, и так же получает сроки. */
export function fillGuidePageHero(
  hero: GuidePageHero,
  fill: (text: string) => string,
): GuidePageHero {
  return {
    badge: fill(hero.badge),
    lead: fill(hero.lead),
    highlights: hero.highlights.map(fill),
  };
}

function fillBlock(
  block: GuidePageBlock,
  fill: (text: string) => string,
): GuidePageBlock {
  switch (block.kind) {
    case "hero":
      return { ...block, ...fillGuidePageHero(block, fill) };
    case "cards":
      return {
        ...block,
        eyebrow: fill(block.eyebrow),
        title: fill(block.title),
        lead: fill(block.lead),
        note: fill(block.note),
        items: block.items.map((item) => ({
          title: fill(item.title),
          text: fill(item.text),
          detailLabel: fill(item.detailLabel),
          detail: fill(item.detail),
        })),
      };
    case "text":
      return {
        ...block,
        title: fill(block.title),
        paragraphs: block.paragraphs.map(fill),
      };
    case "steps":
      return {
        ...block,
        title: fill(block.title),
        lead: fill(block.lead),
        link: fill(block.link),
        items: block.items.map((item) => ({
          title: fill(item.title),
          text: fill(item.text),
        })),
      };
    case "list":
      return {
        ...block,
        title: fill(block.title),
        text: fill(block.text),
        items: block.items.map(fill),
      };
    case "trial":
      return {
        ...block,
        title: fill(block.title),
        text: fill(block.text),
        link: fill(block.link),
      };
  }
}
export type GuidePageCard = z.infer<typeof cardSchema>;
export type GuidePageBlockOf<K extends GuidePageBlock["kind"]> = Extract<
  GuidePageBlock,
  { kind: K }
>;

/** Как нарисовать продукт: известное оформление и описание, прошедшее схему. */
export interface GuideProductPage {
  readonly presentation: GuidePresentation;
  readonly page: GuidePage | null;
}

/**
 * Куда уходит предупреждение о рассинхроне данных и выпуска сайта. Оба чтения описания живут в
 * серверных адаптерах, поэтому по умолчанию это журнал сервера; тест подставляет свой приёмник.
 */
export type PresentationWarning = (message: string) => void;
const reportToServerLog: PresentationWarning = (message) => {
  console.warn(message);
};

export function resolveGuidePresentation(
  value: string,
  context: string,
  warn: PresentationWarning = reportToServerLog,
): GuidePresentation {
  const known = guidePresentations.find(
    (presentation) => presentation === value,
  );
  if (known !== undefined) return known;
  warn(
    `[guide-presentation] ${context}: unknown presentation "${value}"; the default template is shown`,
  );
  return "default";
}

/**
 * Неизвестное оформление показывает общий шаблон, неверное описание не показывается; оба случая
 * пишут предупреждение, потому что так выглядит рассинхрон данных и выпуска сайта.
 */
export function readGuideProductPage(
  value: { readonly presentation: string; readonly page: unknown },
  context: string,
  warn: PresentationWarning = reportToServerLog,
): GuideProductPage {
  const presentation = resolveGuidePresentation(
    value.presentation,
    context,
    warn,
  );
  // Продукт без описания — обычное дело: его страницу рисует общий шаблон по полям редактора.
  if (value.page === null || value.page === undefined)
    return { presentation, page: null };
  const parsed = guidePageSchema.safeParse(value.page);
  if (!parsed.success)
    warn(
      `[guide-presentation] ${context}: the stored page description does not match this site; it is not shown`,
    );
  return { presentation, page: parsed.success ? parsed.data : null };
}

/** Подпись карточки Главной читается отдельно от продукта: её ошибка не скрывает сам продукт. */
export function readGuidePageCard(
  value: unknown,
  context: string,
  warn: PresentationWarning = reportToServerLog,
): GuidePageCard | null {
  if (value === null || value === undefined) return null;
  const parsed = cardSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  warn(
    `[guide-presentation] ${context}: the stored Home card caption does not match this site; it is not shown`,
  );
  return null;
}

/** Первый экран продукта для карточки Главной: поля блока `hero` без его `id` и вида. */
const heroSchema = heroBlockSchema.omit({ id: true, kind: true });
export type GuidePageHero = z.infer<typeof heroSchema>;

export function readGuidePageHero(
  value: unknown,
  context: string,
  warn: PresentationWarning = reportToServerLog,
): GuidePageHero | null {
  if (value === null || value === undefined) return null;
  const parsed = heroSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  warn(
    `[guide-presentation] ${context}: the stored Home hero does not match this site; it is not shown`,
  );
  return null;
}

/** Сроки, которые автор пишет подстановкой: страница повторяет предложение продукта, а не свои числа. */
export interface OfferTerms {
  readonly access: string;
  readonly support: string;
}

export function fillOfferTerms(text: string, terms: OfferTerms): string {
  return text
    .replaceAll("{access_term}", terms.access)
    .replaceAll("{support_term}", terms.support);
}
