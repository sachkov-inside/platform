import { z } from "zod";

/**
 * Словарь прав доступа Inside и то, что каждое право открывает на самом деле.
 *
 * Владелец один, потому что правило нужно обеим сторонам и по разным поводам: сервер выдаёт права
 * и решает, что действует, а браузер называет состав доступа **до** покупки, когда сервер ещё
 * ничего не выдал. Пока описаний было два, расхождение между ними ничем не ловилось, и покупатель
 * мог увидеть на витрине один состав, а получить другой.
 */
export const globalAccessCapabilities = [
  "materials",
  "community",
  "reviews",
  "support",
] as const;

export const accessCapabilitySchema: z.ZodUnion<
  readonly [
    z.ZodEnum<z.core.util.ToEnum<(typeof globalAccessCapabilities)[number]>>,
    z.ZodTemplateLiteral<`product:${string}`>,
  ]
> = z.union([
  z.enum(globalAccessCapabilities),
  z.templateLiteral(["product:", z.uuid()]),
]);

export type AccessCapability = z.infer<typeof accessCapabilitySchema>;

/** Право на один конкретный Product; принимает и сырую строку прежней записи. */
export function isProductCapability(capability: string): boolean {
  return capability.startsWith("product:");
}

/** Право на конкретный Product: строка права собирается и читается одним владельцем. */
export function productCapability(productId: string): AccessCapability {
  return `product:${productId}`;
}

/** Идентификатор продукта из уже проверенного права; глобальное право продукта не называет. */
export function productIdFromCapability(
  capability: AccessCapability,
): string | null {
  return isProductCapability(capability)
    ? capability.slice("product:".length)
    : null;
}

/**
 * Что открывает одно право. Общая группа одна на всех (#648, решение владельца): её открывает и
 * купленный Product, и сопровождение, поэтому участие живёт сроком самого долгого из них.
 */
export function capabilitiesOpenedBy(
  capability: AccessCapability,
): readonly AccessCapability[] {
  return isProductCapability(capability) || capability === "support"
    ? [capability, "community"]
    : [capability];
}

/**
 * Право, которое на релизе не выдаёт ни одно основание (#648): ни покупка, ни тариф, ни мост.
 * Словарь его ещё называет, чтобы читались прежние записи, но действующим оно не становится.
 */
export const withheldAccessCapabilities: readonly AccessCapability[] = [
  "reviews",
];

/** Не выдаётся ли право: принимает и сырую строку прежней записи. */
export function isWithheldCapability(capability: string): boolean {
  return withheldAccessCapabilities.some((withheld) => withheld === capability);
}

/**
 * Какие из этих прав открывают названное право. Срок такого права держится каждым из них, поэтому
 * спрашивать надо у вывода, а не перечислять открывающие права заново на своей стороне.
 */
export function capabilitiesOpening(
  opened: AccessCapability,
  capabilities: readonly AccessCapability[],
): readonly AccessCapability[] {
  return capabilities.filter((capability) =>
    capabilitiesOpenedBy(capability).includes(opened),
  );
}

/**
 * Состав доступа, который открывает набор прав: то же правило, применённое к каждому праву. Набор
 * сохраняет свой порядок, а право, которое открылось попутно, дописывается в конец — так состав
 * читается как «что купили, и что к этому прилагается». Уже названное право не повторяется.
 */
export function accessComposition(
  capabilities: readonly AccessCapability[],
): readonly AccessCapability[] {
  const composed = [...capabilities];
  for (const opened of capabilities.flatMap(capabilitiesOpenedBy)) {
    if (!composed.includes(opened)) composed.push(opened);
  }
  return composed;
}

/** Explicit products included by a tier. Legacy promises are frozen by the migration baseline. */
export const coverageSchema: z.ZodObject<
  {
    productIds: z.ZodArray<z.ZodUUID>;
    materialIds: z.ZodArray<z.ZodUUID>;
    wholePlatform: z.ZodExactOptional<z.ZodLiteral<true>>;
  },
  z.core.$strict
> = z
  .strictObject({
    productIds: z
      .array(z.uuid())
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
    materialIds: z
      .array(z.uuid())
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
    /**
     * Все продукты платформы, включая опубликованные позже: состав подписки и стартового тарифа.
     * Отдельные материалы состав не образуют; прежние снимки ещё могут их называть.
     */
    wholePlatform: z.literal(true).exactOptional(),
  })
  .refine(
    // «Все продукты» ничего не перечисляет: иначе состав противоречил бы сам себе.
    (scope) =>
      scope.wholePlatform !== true ||
      (scope.productIds.length === 0 && scope.materialIds.length === 0),
  );
export type Coverage = z.infer<typeof coverageSchema>;

/** Открывает ли состав продукт: продукт назван явно или состав включает все продукты. */
export function scopeIncludesProduct(
  scope: Coverage,
  productId: string,
): boolean {
  return scope.wholePlatform === true || scope.productIds.includes(productId);
}

/**
 * Открывает ли состав ресурс: один из его продуктов входит в состав, или прежний снимок называет
 * сам материал.
 */
export function scopeOpensResource(
  scope: Coverage,
  resource: {
    readonly productIds: readonly string[];
    readonly materialId?: string | undefined;
  },
): boolean {
  return (
    resource.productIds.some((id) => scopeIncludesProduct(scope, id)) ||
    (resource.materialId !== undefined &&
      scope.materialIds.includes(resource.materialId))
  );
}

/**
 * Состав, который ничего не открывает: его нет, он не читается как состав или в нём нет ни одного
 * Product и материала. Тариф с таким составом дал бы чат без материалов, поэтому его нельзя
 * ни назначить, ни продать.
 */
export function isEmptyCoverage(scope: unknown): boolean {
  const parsed = coverageSchema.safeParse(scope);
  return (
    !parsed.success ||
    (parsed.data.wholePlatform !== true &&
      parsed.data.productIds.length === 0 &&
      parsed.data.materialIds.length === 0)
  );
}

const coverageEntryKinds = ["product", "material"] as const;

export const coverageEntrySchema: z.ZodObject<
  {
    kind: z.ZodEnum<z.core.util.ToEnum<(typeof coverageEntryKinds)[number]>>;
    id: z.ZodUUID;
    title: z.ZodString;
    slug: z.ZodNullable<z.ZodString>;
    available: z.ZodBoolean;
  },
  z.core.$strict
> = z.strictObject({
  kind: z.enum(coverageEntryKinds),
  id: z.uuid(),
  title: z.string(),
  slug: z.string().nullable(),
  available: z.boolean(),
});

export const benefitPeriodsSchema: z.ZodArray<
  z.ZodObject<
    {
      capability: typeof accessCapabilitySchema;
      months: z.ZodNullable<z.ZodNumber>;
    },
    z.core.$strict
  >
> = z
  .array(
    z.strictObject({
      capability: accessCapabilitySchema,
      months: z.int().positive().max(1200).nullable(),
    }),
  )
  .max(100);

export { subscriptionPeriodEnd, MOSCOW_OFFSET_MS } from "./calendar-period.js";

/** Состав материалов тарифа учитывает и прямое право на продукт, и явный охват. */
export function tariffCoverage(
  benefits: readonly string[],
  scope: Coverage,
): Coverage {
  if (scope.wholePlatform === true) return scope;
  return {
    ...scope,
    productIds: [
      ...new Set([
        ...scope.productIds,
        ...benefits
          .filter(isProductCapability)
          .map((capability) => capability.slice("product:".length)),
      ]),
    ],
  };
}
