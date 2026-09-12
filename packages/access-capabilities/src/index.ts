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
 * Что открывает одно право. Купленное руководство само по себе открывает общий чат сообщества:
 * чат один на всех, и участие в нём живёт ровно сроком права на руководство.
 */
export function capabilitiesOpenedBy(
  capability: AccessCapability,
): readonly AccessCapability[] {
  return isGuideCapability(capability) ? [capability, "community"] : [capability];
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
