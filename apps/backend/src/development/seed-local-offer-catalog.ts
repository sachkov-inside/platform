import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { BillingPricing } from "../modules/billing/index.js";

/**
 * Каталог предложений локального стенда: две подписки и разовая покупка засеянного руководства.
 * Без него покупку нельзя пройти сразу после seed — предложение, вариант оплаты и включённую
 * продажу приходится заводить руками перед каждой проверкой.
 *
 * Каталог заводится теми же командами, которыми его заводит владелец в `/authoring/billing`, а не
 * прямой записью в таблицы billing: проверка прав, revision и receipt повтора здесь настоящие.
 * Production-каталог и настоящие цены остаются решением владельца в админке; сюда они не попадают,
 * и seed демонстрационных данных исполняется только в development.
 */

/**
 * Цены стенда собраны одним местом и заведомо не продуктовые: десять, двадцать и тридцать рублей.
 * Столько не стоит ни подписка, ни руководство, поэтому такой каталог нельзя принять за рабочий.
 */
const testPriceKopecks = {
  materials: 1_000,
  materialsWithSupport: 2_000,
  guide: 3_000,
} as const;

interface CatalogOffer {
  readonly offerId: string;
  readonly name: string;
  readonly benefits: readonly string[];
  /** Право с собственным сроком: `null` — бессрочно, иначе столько календарных месяцев. */
  readonly benefitPeriods: readonly {
    readonly capability: string;
    readonly months: number | null;
  }[];
  readonly option: {
    readonly id: string;
    readonly mode: "subscription" | "one_time";
    readonly months: number;
    readonly priceKopecks: number;
  };
  /**
   * Постоянные идентификаторы владельческих команд. Повторный seed попадает в receipt уже
   * применённой команды: второго набора предложений не появляется, а заведённое или изменённое
   * руками остаётся как есть.
   */
  readonly operations: {
    readonly save: string;
    readonly option: string;
    readonly publish: string;
  };
}

function localCatalog(guideId: string): readonly CatalogOffer[] {
  return [
    {
      offerId: "72000000-0000-4000-8000-000000000501",
      name: "Материалы",
      benefits: ["materials"],
      benefitPeriods: [],
      option: {
        id: "72000000-0000-4000-8000-000000000511",
        mode: "subscription",
        months: 1,
        priceKopecks: testPriceKopecks.materials,
      },
      operations: {
        save: "72000000-0000-4000-8000-000000000521",
        option: "72000000-0000-4000-8000-000000000522",
        publish: "72000000-0000-4000-8000-000000000523",
      },
    },
    {
      offerId: "72000000-0000-4000-8000-000000000502",
      name: "Материалы + сопровождение",
      benefits: ["materials", "support"],
      benefitPeriods: [],
      option: {
        id: "72000000-0000-4000-8000-000000000512",
        mode: "subscription",
        months: 1,
        priceKopecks: testPriceKopecks.materialsWithSupport,
      },
      operations: {
        save: "72000000-0000-4000-8000-000000000524",
        option: "72000000-0000-4000-8000-000000000525",
        publish: "72000000-0000-4000-8000-000000000526",
      },
    },
    {
      offerId: "72000000-0000-4000-8000-000000000503",
      name: "Руководство «Создание Platform Inside»",
      benefits: [`guide:${guideId}`],
      // Разовая покупка открывает руководство навсегда: оплаченного срока у неё нет.
      benefitPeriods: [{ capability: `guide:${guideId}`, months: null }],
      option: {
        id: "72000000-0000-4000-8000-000000000513",
        mode: "one_time",
        months: 1,
        priceKopecks: testPriceKopecks.guide,
      },
      operations: {
        save: "72000000-0000-4000-8000-000000000527",
        option: "72000000-0000-4000-8000-000000000528",
        publish: "72000000-0000-4000-8000-000000000529",
      },
    },
  ];
}

export async function seedLocalOfferCatalog(
  prisma: PlatformPrisma,
  target: { readonly actor: string; readonly guideId: string },
): Promise<void> {
  const pricing = new BillingPricing({
    prisma,
    accounts: localCatalogPermission(target.actor),
  });
  for (const offer of localCatalog(target.guideId)) {
    const saved = await applyOwnerCommand(pricing, target.actor, {
      operationId: offer.operations.save,
      operation: "offers.save",
      value: {
        id: offer.offerId,
        name: offer.name,
        benefits: [...offer.benefits],
        benefitPeriods: [...offer.benefitPeriods],
      },
    });
    await applyOwnerCommand(pricing, target.actor, {
      operationId: offer.operations.option,
      operation: "paymentOptions.save",
      value: {
        id: offer.option.id,
        offerId: offer.offerId,
        mode: offer.option.mode,
        months: offer.option.months,
        priceKopecks: offer.option.priceKopecks,
      },
    });
    // По умолчанию не продаётся ничего: сохранённое предложение выключено из продажи. Локальный
    // стенд включает её отдельной владельческой командой, и это видно строкой, а не умолчанием.
    await applyOwnerCommand(pricing, target.actor, {
      operationId: offer.operations.publish,
      operation: "offers.publish",
      id: offer.offerId,
      expectedRevision: saved.revision,
    });
  }
}

async function applyOwnerCommand(
  pricing: BillingPricing,
  actor: string,
  command: { readonly operation: string } & Record<string, unknown>,
): Promise<{ readonly revision: number }> {
  const result = await pricing.manage(actor, command);
  if (!result.ok) {
    throw new Error(
      `Local offer catalog ${command.operation} failed: ${result.error.code}`,
    );
  }
  return result.value;
}

/**
 * Владельческий Account заводится release-бутстрапом уже после seed, поэтому право на каталог
 * объявляет сам стенд — и ровно для своего синтетического владельца, как это уже делает
 * авторская политика материалов. Всё остальное в команде проверяет тот же use case, что и админка.
 */
function localCatalogPermission(actor: string) {
  return {
    checkPermission: ({ accountId }: { readonly accountId: string }) =>
      Promise.resolve({ ok: true as const, allowed: accountId === actor }),
  };
}
