import { z } from "zod";
import { idSchema } from "../../domain/pricing.js";

const count = z.int().nonnegative();
/** Колонка анкеты вставляется целиком; тысяча-другая строк с запасом помещается в предел. */
const maximumListLength = 200_000;
/** Сводка показывает весь список: он мал, а владелец ищет в нём людей по нику. */
export const maximumRespondents = 5000;

export const importRespondentsSchema = z.strictObject({
  operationId: idSchema,
  list: z.string().min(1).max(maximumListLength),
});
export const issueRespondentLinkSchema = z.strictObject({
  operationId: idSchema,
  /** Ник в любой форме анкеты: `@nick`, `nick` или ссылка t.me. */
  username: z.string().trim().min(1).max(200),
  /**
   * Архивная акция-шаблон: её процент, срок и область копируются в личную акцию с одноразовым
   * промокодом. Архив гарантирует, что шаблон сам ничего не продаёт.
   */
  templatePromotionId: idSchema,
});

/** Итог импорта — только счётчики: содержимое списка не попадает в журнал владельца. */
export const respondentImportSchema = z.strictObject({
  /** Распознанные уникальные ники в этой вставке. */
  recognized: count,
  /** Новые ники, которых в списке ещё не было. */
  added: count,
  /** Строки, в которых ник не распознан: email, телефон и прочее. */
  unrecognized: count,
  /** Размер списка после импорта. */
  total: count,
});
export const respondentLinkSchema = z.strictObject({
  promotionId: idSchema,
  code: z.string().min(1).max(100),
  /**
   * Slug продукта, если область шаблона продаёт ровно один продукт: Web собирает из него адрес
   * страницы оплаты с промокодом. Иначе `null`, и владелец отправляет код.
   */
  productSlug: z.string().nullable(),
  /** Этому нику ссылка уже была выдана: возвращается прежняя, новая не создаётся. */
  alreadyIssued: z.boolean(),
});
export const respondentsViewSchema = z.strictObject({
  total: count,
  issued: count,
  purchased: count,
  respondents: z
    .array(
      z.strictObject({
        username: z.string(),
        issuedAt: z.iso.datetime().nullable(),
        /** Покупка по личной ссылке подтверждена банком. */
        purchased: z.boolean(),
      }),
    )
    .max(maximumRespondents),
});
