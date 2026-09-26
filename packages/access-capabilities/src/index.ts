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
    z.ZodTemplateLiteral<`guide:${string}`>,
  ]
> = z.union([
  z.enum(globalAccessCapabilities),
  z.templateLiteral(["guide:", z.uuid()]),
]);

export type AccessCapability = z.infer<typeof accessCapabilitySchema>;

/** Право на одно конкретное руководство, независимое от состава тарифа подписки. */
export function isGuideCapability(capability: AccessCapability): boolean {
  return capability.startsWith("guide:");
}

/** Право на конкретное руководство: строка права собирается и читается одним владельцем. */
export function guideCapability(guideId: string): AccessCapability {
  return `guide:${guideId}`;
}

/**
 * Что открывает одно право. Общая группа одна на всех (#648, решение владельца): её открывает и
 * купленное руководство, и сопровождение, поэтому участие живёт сроком самого долгого из них.
 */
export function capabilitiesOpenedBy(
  capability: AccessCapability,
): readonly AccessCapability[] {
  return isGuideCapability(capability) || capability === "support"
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
export const contentScopeSchema: z.ZodObject<
  {
    guideIds: z.ZodArray<z.ZodUUID>;
    materialIds: z.ZodArray<z.ZodUUID>;
    allGuides: z.ZodExactOptional<z.ZodLiteral<true>>;
  },
  z.core.$strict
> = z
  .strictObject({
    guideIds: z
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
    allGuides: z.literal(true).exactOptional(),
  })
  .refine(
    // «Все продукты» ничего не перечисляет: иначе состав противоречил бы сам себе.
    (scope) =>
      scope.allGuides !== true ||
      (scope.guideIds.length === 0 && scope.materialIds.length === 0),
  );
export type ContentScope = z.infer<typeof contentScopeSchema>;

/** Открывает ли состав продукт: продукт назван явно или состав включает все продукты. */
export function scopeIncludesGuide(
  scope: ContentScope,
  guideId: string,
): boolean {
  return scope.allGuides === true || scope.guideIds.includes(guideId);
}

/**
 * Открывает ли состав ресурс: один из его продуктов входит в состав, или прежний снимок называет
 * сам материал.
 */
export function scopeOpensResource(
  scope: ContentScope,
  resource: {
    readonly guideIds: readonly string[];
    readonly materialId?: string | undefined;
  },
): boolean {
  return (
    resource.guideIds.some((id) => scopeIncludesGuide(scope, id)) ||
    (resource.materialId !== undefined &&
      scope.materialIds.includes(resource.materialId))
  );
}

/**
 * Состав, который ничего не открывает: его нет, он не читается как состав или в нём нет ни одного
 * руководства и материала. Тариф с таким составом дал бы чат без материалов, поэтому его нельзя
 * ни назначить, ни продать.
 */
export function isEmptyContentScope(scope: unknown): boolean {
  const parsed = contentScopeSchema.safeParse(scope);
  return (
    !parsed.success ||
    (parsed.data.allGuides !== true &&
      parsed.data.guideIds.length === 0 &&
      parsed.data.materialIds.length === 0)
  );
}

const contentScopeEntryKinds = ["guide", "material"] as const;

export const contentScopeEntrySchema: z.ZodObject<
  {
    kind: z.ZodEnum<
      z.core.util.ToEnum<(typeof contentScopeEntryKinds)[number]>
    >;
    id: z.ZodUUID;
    title: z.ZodString;
    slug: z.ZodNullable<z.ZodString>;
    available: z.ZodBoolean;
  },
  z.core.$strict
> = z.strictObject({
  kind: z.enum(contentScopeEntryKinds),
  id: z.uuid(),
  title: z.string(),
  slug: z.string().nullable(),
  available: z.boolean(),
});
