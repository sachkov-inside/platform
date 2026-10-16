import { productCapability } from "@inside/access-capabilities";
import type { AccessGround } from "@/entities/subscription";

/** Manual and legacy access do not establish that the learner bought this Product. */
export function hasPaidProductAccess(
  grounds: readonly AccessGround[],
  productId: string,
): boolean {
  return grounds.some(
    (ground) =>
      ground.active &&
      ground.source === "paid" &&
      ground.capabilities.some(
        (capability) => capability === productCapability(productId),
      ),
  );
}
