import { randomUUID } from "node:crypto";

import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { BillingPricing } from "../modules/billing/index.js";

/**
 * Каталог предложений локального стенда: две подписки и разовая покупка засеянного руководства.
 * Без него покупку нельзя пройти сразу после seed — предложение, вариант оплаты и включённую
 * продажу приходится заводить руками перед каждой проверкой.
 *
 * Каталог заводится теми же командами, которыми его заводит владелец в `/authoring/billing`, а не
 * прямой записью в таблицы billing: разбор команды, проверка revision и кросс-полевые правила
 * здесь настоящие. Право на управление каталогом стенд объявляет сам — владельческий Account
 * появляется позже. Production-каталог и настоящие цены остаются решением владельца в админке;
 * сюда они не попадают, и seed демонстрационных данных исполняется только в development.
 */

/**
 * Цены стенда собраны одним местом и заведомо не продуктовые: десять, двадцать и тридцать рублей.
 * Столько не стоит ни подписка, ни руководство, поэтому такой каталог нельзя принять за рабочий.
 * Ниже не опускаемся: минимальную сумму платежа назначает терминал, и рубль может её не пройти.
 */
const localStandPriceKopecks = {
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
    /** Период списания подписки. У разовой покупки со своим сроком права он ни на что не влияет. */
    readonly months: number;
    readonly priceKopecks: number;
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
        priceKopecks: localStandPriceKopecks.materials,
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
        priceKopecks: localStandPriceKopecks.materialsWithSupport,
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
        priceKopecks: localStandPriceKopecks.guide,
      },
    },
  ];
}

type OwnerCatalogResult = Awaited<ReturnType<BillingPricing["ownerCatalog"]>>;
/** Снимок цены одного варианта оплаты — то, чем каталог отвечает своему владельцу. */
type CatalogSnapshot = Extract<OwnerCatalogResult, { ok: true }>["value"]["items"][number];

/**
 * Приводит каталог стенда к описанию выше. Повторный запуск на совпадающем каталоге не отправляет
 * ни одной команды, поэтому второго набора предложений не появляется и продажа, выключенная
 * владельцем, остаётся выключенной. Изменённая цена — это изменение описания, и она применяется
 * обычной владельческой командой с текущим revision, а не требует чистого тома.
 */
export async function seedLocalOfferCatalog(
  prisma: PlatformPrisma,
  target: { readonly actor: string; readonly guideId: string },
): Promise<void> {
  const pricing = new BillingPricing({
    prisma,
    accounts: standOwnerPermission(target.actor),
  });
  const current = await readOwnerCatalog(pricing);
  for (const offer of localCatalog(target.guideId)) {
    const live = current.get(offer.option.id);
    if (live !== undefined && matchesDefinition(live, offer)) continue;
    const saveOption = (expectedRevision?: number) =>
      sendCatalogCommand(pricing, target.actor, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        value: {
          id: offer.option.id,
          offerId: offer.offerId,
          mode: offer.option.mode,
          months: offer.option.months,
          priceKopecks: offer.option.priceKopecks,
        },
      });
    const saved = await sendCatalogCommand(pricing, target.actor, {
      operation: "offers.save",
      operationId: randomUUID(),
      ...(live === undefined ? {} : { expectedRevision: live.offer.revision }),
      value: {
        id: offer.offerId,
        name: offer.name,
        benefits: [...offer.benefits],
        benefitPeriods: [...offer.benefitPeriods],
      },
    });
    if (saved === undefined) {
      // Предложение есть, а живого варианта оплаты у него нет: прошлый запуск оборвался между
      // двумя командами. Продавать в таком каталоге нечего, поэтому стенд досоздаёт только
      // недостающий вариант и больше ничего не трогает.
      if (live === undefined) await saveOption();
      continue;
    }
    const option = await saveOption(live?.paymentOption.revision);
    if (option === undefined || live !== undefined) continue;
    // По умолчанию не продаётся ничего: сохранённое предложение выключено из продажи. Новое
    // предложение стенда включает в продажу отдельная владельческая команда — строкой ниже.
    // Уже заведённому продажу не возвращаем: её состоянием распоряжается владелец.
    await sendCatalogCommand(pricing, target.actor, {
      operation: "offers.publish",
      operationId: randomUUID(),
      id: offer.offerId,
      expectedRevision: saved.revision,
    });
  }
}

/** Весь неархивный каталог владельца по идентификатору варианта оплаты, включая снятый с продажи. */
async function readOwnerCatalog(
  pricing: BillingPricing,
): Promise<ReadonlyMap<string, CatalogSnapshot>> {
  const snapshots = new Map<string, CatalogSnapshot>();
  let cursor: string | undefined;
  do {
    const page = await pricing.ownerCatalog({
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) {
      throw new Error(`Local offer catalog read failed: ${page.error.code}`);
    }
    for (const snapshot of page.value.items) {
      snapshots.set(snapshot.paymentOption.id, snapshot);
    }
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return snapshots;
}

function matchesDefinition(
  snapshot: CatalogSnapshot,
  offer: CatalogOffer,
): boolean {
  const periods = snapshot.offer.benefitPeriods ?? [];
  return (
    snapshot.offer.id === offer.offerId &&
    snapshot.offer.name === offer.name &&
    sameCapabilities(snapshot.offer.benefits, offer.benefits) &&
    periods.length === offer.benefitPeriods.length &&
    offer.benefitPeriods.every((period) =>
      periods.some(
        (live) =>
          live.capability === period.capability && live.months === period.months,
      ),
    ) &&
    (snapshot.paymentOption.mode ?? "subscription") === offer.option.mode &&
    snapshot.paymentOption.months === offer.option.months &&
    snapshot.paymentOption.priceKopecks === offer.option.priceKopecks
  );
}

function sameCapabilities(
  live: readonly string[],
  wanted: readonly string[],
): boolean {
  return (
    live.length === wanted.length && wanted.every((value) => live.includes(value))
  );
}

/**
 * Одна владельческая команда каталога. Конфликт revision или операции возвращает `undefined`:
 * стенд сообщает о такой строке и не настаивает, потому что упавший seed не даёт подняться всему
 * локальному стеку. Остальные ошибки — дефект описания выше, и они останавливают seed.
 */
async function sendCatalogCommand(
  pricing: BillingPricing,
  actor: string,
  command: { readonly operation: string } & Record<string, unknown>,
): Promise<{ readonly revision: number } | undefined> {
  const result = await pricing.manage(actor, command);
  if (result.ok) return result.value;
  if (
    result.error.code === "revision_conflict" ||
    result.error.code === "operation_conflict"
  ) {
    console.error(
      `Local offer catalog: ${command.operation} left to the owner (${result.error.code})`,
    );
    return undefined;
  }
  throw new Error(
    `Local offer catalog ${command.operation} failed: ${result.error.code}`,
  );
}

/**
 * Права стенда для каталога. Владельческий Account заводится release-бутстрапом уже после seed,
 * поэтому спросить настоящее право не у кого: стенд отвечает за своего синтетического владельца
 * сам, как это уже делает авторская политика материалов. Всё остальное в команде — разбор,
 * revision и кросс-полевые правила — проверяет тот же use case, что и админка.
 */
function standOwnerPermission(actor: string) {
  return {
    checkPermission: ({ accountId }: { readonly accountId: string }) =>
      Promise.resolve({ ok: true as const, allowed: accountId === actor }),
  };
}
