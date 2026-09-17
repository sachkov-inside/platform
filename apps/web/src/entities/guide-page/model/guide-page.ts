import { z } from "zod";

/**
 * Описание страницы продукта из авторского оригинала (ADR 0026). Backend проверяет его при
 * переносе; web читает ответ как внешнее значение и сам решает, чем его нарисовать.
 */

/** Оформления, которые умеет рисовать этот web. Страница и карточка Главной держат карту по ним. */
export const guidePresentations = ["default", "ai-first-process"] as const;
export type GuidePresentation = (typeof guidePresentations)[number];

const cardItemSchema = z
  .object({ title: z.string(), text: z.string(), detailLabel: z.string(), detail: z.string() })
  .strict();
const stepSchema = z.object({ title: z.string(), text: z.string() }).strict();
const blockSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("hero"), lead: z.string(), highlights: z.array(z.string()) }).strict(),
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
  z.object({ id: z.string(), kind: z.literal("text"), title: z.string(), paragraphs: z.array(z.string()) }).strict(),
  z
    .object({ id: z.string(), kind: z.literal("steps"), title: z.string(), lead: z.string(), items: z.array(stepSchema), link: z.string() })
    .strict(),
  z.object({ id: z.string(), kind: z.literal("list"), title: z.string(), text: z.string(), items: z.array(z.string()) }).strict(),
  z.object({ id: z.string(), kind: z.literal("trial"), title: z.string(), text: z.string(), link: z.string() }).strict(),
]);
const cardSchema = z.object({ eyebrow: z.string(), subtitle: z.string(), action: z.string() }).strict();
export const guidePageSchema = z.object({ card: cardSchema.nullable(), blocks: z.array(blockSchema) }).strict();

export type GuidePage = z.infer<typeof guidePageSchema>;
export type GuidePageBlock = GuidePage["blocks"][number];
export type GuidePageCard = z.infer<typeof cardSchema>;
export type GuidePageBlockOf<K extends GuidePageBlock["kind"]> = Extract<GuidePageBlock, { kind: K }>;

/** Как нарисовать продукт: известное оформление и описание, прошедшее схему. */
export interface GuideProductPage {
  readonly presentation: GuidePresentation;
  readonly page: GuidePage | null;
}

/** Серверный журнал предупреждений; тест подставляет свой. */
export type PresentationWarning = (message: string) => void;
const warnOnServer: PresentationWarning = (message) => {
  console.warn(message);
};

export function resolveGuidePresentation(
  value: string,
  context: string,
  warn: PresentationWarning = warnOnServer,
): GuidePresentation {
  const known = guidePresentations.find((presentation) => presentation === value);
  if (known !== undefined) return known;
  warn(`[guide-presentation] ${context}: unknown presentation "${value}"; the default template is shown`);
  return "default";
}

/**
 * Неизвестное оформление показывает общий шаблон, неверное описание не показывается; оба случая
 * пишут предупреждение, потому что так выглядит рассинхрон данных и выпуска сайта.
 */
export function readGuideProductPage(
  value: { readonly presentation: string; readonly page: unknown },
  context: string,
  warn: PresentationWarning = warnOnServer,
): GuideProductPage {
  const parsed = guidePageSchema.safeParse(value.page);
  if (!parsed.success) warn(`[guide-presentation] ${context}: the stored page description does not match this site; it is not shown`);
  return {
    presentation: resolveGuidePresentation(value.presentation, context, warn),
    page: parsed.success ? parsed.data : null,
  };
}

/** Сроки оферты, которые автор пишет подстановкой: страница повторяет оферту, а не свои числа. */
export interface OfferTerms {
  readonly access: string;
  readonly support: string;
}

export function fillOfferTerms(text: string, terms: OfferTerms): string {
  return text.replaceAll("{access_term}", terms.access).replaceAll("{support_term}", terms.support);
}
