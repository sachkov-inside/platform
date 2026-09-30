import { randomBytes, randomUUID } from "node:crypto";
import { guideCapability } from "@inside/access-capabilities";
import type { z } from "zod";
import {
  lockBillingPricing,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import {
  normalizeTelegramUsername,
  parseRespondentList,
} from "../../domain/telegram-username.js";
import {
  maximumRespondents,
  type importRespondentsSchema,
  type issueRespondentLinkSchema,
  type respondentImportSchema,
  type respondentLinkSchema,
  type respondentsViewSchema,
} from "./survey-respondents.contract.js";

type Failure<Code extends string> = {
  readonly ok: false;
  readonly error: { readonly code: Code };
};
type Result<Value, Code extends string> =
  { readonly ok: true; readonly value: Value } | Failure<Code>;
const fail = <const Code extends string>(code: Code): Failure<Code> => ({
  ok: false,
  error: { code },
});
/** 9 случайных байт — 12 символов base64url: код не угадать перебором по ссылкам. */
const promoCodeBytes = 9;

interface IssueDependencies {
  readonly prisma: BillingPrismaClient;
  readonly grants: Pick<AccessGrants, "readContentCatalog">;
}

/**
 * Добавляет ники анкеты в список. Импорт только дополняет: повтор той же колонки ничего не
 * меняет, а выданные ссылки остаются за своими никами.
 */
export async function importRespondents(
  prisma: BillingPrismaClient,
  command: z.infer<typeof importRespondentsSchema>,
  now: Date,
): Promise<Result<z.infer<typeof respondentImportSchema>, "invalid_request">> {
  const parsed = parseRespondentList(command.list);
  const usernames = [...parsed.usernames];
  // Предел и вставка под той же блокировкой, что и выдача: параллельный импорт не превысит его.
  return prisma.$transaction(async (tx) => {
    await lockBillingPricing(tx);
    // Предел считает только новые ники: повторная вставка той же колонки всегда проходит.
    const listed = await tx.billingSurveyRespondent.count({
      where: { username: { in: usernames } },
    });
    const before = await tx.billingSurveyRespondent.count();
    if (before + usernames.length - listed > maximumRespondents)
      return fail("invalid_request");
    const created = await tx.billingSurveyRespondent.createMany({
      data: usernames.map((username) => ({ username, importedAt: now })),
      skipDuplicates: true,
    });
    return {
      ok: true as const,
      value: {
        recognized: usernames.length,
        added: created.count,
        unrecognized: parsed.unrecognized,
        total: before + created.count,
      },
    };
  });
}

/**
 * Выдаёт нику из списка личную акцию с одноразовым промокодом по архивному шаблону. Ник получает
 * не больше одной ссылки: повтор возвращает выданную.
 */
export async function issueRespondentLink(
  dependencies: IssueDependencies,
  actorId: string,
  command: z.infer<typeof issueRespondentLinkSchema>,
  now: Date,
): Promise<
  Result<
    z.infer<typeof respondentLinkSchema>,
    "invalid_request" | "not_found" | "state_conflict"
  >
> {
  const username = normalizeTelegramUsername(command.username);
  if (username === null) return fail("invalid_request");
  const issued = await dependencies.prisma.$transaction(
    async (
      tx,
    ): Promise<
      Result<
        { promotionId: string; code: string; alreadyIssued: boolean },
        "not_found" | "state_conflict"
      >
    > => {
      await lockBillingPricing(tx);
      const respondent = await tx.billingSurveyRespondent.findUnique({
        where: { username },
        include: { promotion: true },
      });
      if (respondent === null) return fail("not_found");
      if (respondent.promotion?.code != null)
        return {
          ok: true,
          value: {
            promotionId: respondent.promotion.id,
            code: respondent.promotion.code,
            alreadyIssued: true,
          },
        };
      const template = await tx.billingPromotion.findUnique({
        where: { id: command.templatePromotionId },
      });
      if (template === null) return fail("not_found");
      // Действующий шаблон без кода продавал бы скидку всем, а истёкший выдал бы мёртвую ссылку.
      if (!template.archived || template.endsAt <= now)
        return fail("state_conflict");
      const promotionId = randomUUID();
      const code = randomBytes(promoCodeBytes).toString("base64url");
      await tx.billingPromotion.create({
        data: {
          id: promotionId,
          revision: 1,
          name: template.name,
          percent: template.percent,
          code,
          startsAt: template.startsAt,
          endsAt: template.endsAt,
          offerIds: template.offerIds,
          paymentOptionIds: template.paymentOptionIds,
          usageLimit: 1,
          archived: false,
        },
      });
      await tx.billingSurveyRespondent.update({
        where: { username },
        data: { promotionId, issuedAt: now },
      });
      return { ok: true, value: { promotionId, code, alreadyIssued: false } };
    },
  );
  if (!issued.ok) return issued;
  return {
    ok: true,
    value: {
      ...issued.value,
      guideSlug: await soldGuideSlug(
        dependencies,
        actorId,
        issued.value.promotionId,
      ),
    },
  };
}

/** Сводка для владельца: сколько загружено, кому выдана ссылка и кто по ней купил. */
export async function readRespondents(
  prisma: BillingPrismaClient,
): Promise<z.infer<typeof respondentsViewSchema>> {
  const rows = await prisma.billingSurveyRespondent.findMany({
    orderBy: { username: "asc" },
    take: maximumRespondents,
    include: {
      promotion: {
        select: {
          reservations: {
            where: { state: "confirmed" },
            select: { purchaseRef: true },
            take: 1,
          },
        },
      },
    },
  });
  const respondents = rows.map((row) => ({
    username: row.username,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    purchased: (row.promotion?.reservations.length ?? 0) > 0,
  }));
  // Счётчики берутся из таблицы, а не из показанного списка: он ограничен пределом ответа.
  const [total, issued] = await Promise.all([
    prisma.billingSurveyRespondent.count(),
    prisma.billingSurveyRespondent.count({
      where: { issuedAt: { not: null } },
    }),
  ]);
  return {
    total,
    issued,
    purchased: respondents.filter((row) => row.purchased).length,
    respondents,
  };
}

/**
 * Slug единственного продукта, который продаёт область акции: по нему Web собирает адрес страницы
 * оплаты. Область из нескольких продуктов или без продукта даёт `null`.
 */
async function soldGuideSlug(
  dependencies: IssueDependencies,
  actorId: string,
  promotionId: string,
): Promise<string | null> {
  const promotion = await dependencies.prisma.billingPromotion.findUnique({
    where: { id: promotionId },
  });
  if (promotion === null) return null;
  const offers = await dependencies.prisma.billingOffer.findMany({
    where:
      promotion.offerIds.length > 0
        ? { id: { in: promotion.offerIds } }
        : { options: { some: { id: { in: promotion.paymentOptionIds } } } },
    select: { benefits: true },
  });
  const benefits = new Set(offers.flatMap((offer) => offer.benefits));
  const catalog = await dependencies.grants.readContentCatalog(actorId);
  if (!catalog.ok) return null;
  const guides = catalog.value.filter(
    (entry) =>
      entry.kind === "guide" && benefits.has(guideCapability(entry.id)),
  );
  return guides.length === 1 ? (guides[0]?.slug ?? null) : null;
}
