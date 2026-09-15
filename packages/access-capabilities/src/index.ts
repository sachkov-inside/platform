import { z } from "zod";

/**
 * Словарь прав доступа Inside и то, что каждое право открывает на самом деле.
 *
 * Владелец один, потому что правило нужно обеим сторонам и по разным поводам: сервер выдаёт права
 * и решает, что действует, а браузер называет состав доступа **до** покупки, когда сервер ещё
 * ничего не выдал. Пока описаний было два, расхождение между ними ничем не ловилось, и покупатель
 * мог увидеть на витрине один состав, а получить другой.
 */
export const globalAccessCapabilities = ["materials", "community", "reviews", "support"] as const;

export const accessCapabilitySchema = z.union([
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
  return isGuideCapability(capability) || capability === "support" ? [capability, "community"] : [capability];
}

/**
 * Право, которое на релизе не выдаёт ни одно основание (#648): ни покупка, ни тариф, ни мост.
 * Словарь его ещё называет, чтобы читались прежние записи, но действующим оно не становится.
 */
export const withheldAccessCapabilities: readonly AccessCapability[] = ["reviews"];

/**
 * Какие из этих прав открывают названное право. Срок такого права держится каждым из них, поэтому
 * спрашивать надо у вывода, а не перечислять открывающие права заново на своей стороне.
 */
export function capabilitiesOpening(
  opened: AccessCapability,
  capabilities: readonly AccessCapability[],
): readonly AccessCapability[] {
  return capabilities.filter((capability) => capabilitiesOpenedBy(capability).includes(opened));
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
export const contentScopeSchema = z.strictObject({
  guideIds: z.array(z.uuid()).max(1000).refine(ids => new Set(ids).size === ids.length),
  materialIds: z.array(z.uuid()).max(1000).refine(ids => new Set(ids).size === ids.length),
});
export type ContentScope = z.infer<typeof contentScopeSchema>;

/**
 * Состав, который ничего не открывает: его нет, он не читается как состав или в нём нет ни одного
 * руководства и материала. Тариф с таким составом дал бы чат без материалов, поэтому его нельзя
 * ни назначить, ни продать.
 */
export function isEmptyContentScope(scope: unknown): boolean {
  const parsed = contentScopeSchema.safeParse(scope);
  return !parsed.success || (parsed.data.guideIds.length === 0 && parsed.data.materialIds.length === 0);
}

export const contentScopeEntrySchema = z.strictObject({ kind: z.enum(["guide", "material"]), id: z.uuid(), title: z.string(), slug: z.string().nullable(), available: z.boolean() });
