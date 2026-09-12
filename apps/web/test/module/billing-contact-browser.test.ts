import { expect, it } from "vitest";

import {
  announceBillingContactVerified,
  subscribeBillingContactVerified,
} from "@/features/billing-contact/model/billing-contact-verified-channel";

/**
 * Поверхность, слушающая объявления. Её первое получение — тот факт, на котором заканчивается
 * ожидание: пауза по длительности мерила бы машину, а не доставку.
 */
function listeningSurface(): {
  readonly received: Promise<void>;
  readonly deliveries: () => number;
  readonly stop: () => void;
} {
  let deliveries = 0;
  let deliver: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  const unsubscribe = subscribeBillingContactVerified(() => {
    deliveries += 1;
    deliver?.();
  });
  return {
    received,
    deliveries: () => deliveries,
    stop: () => {
      unsubscribe();
    },
  };
}

it("подтверждение доходит до поверхности, которая его не совершала", async () => {
  const surface = listeningSurface();

  announceBillingContactVerified();

  await surface.received;
  expect(surface.deliveries()).toBe(1);
  surface.stop();
});

it("отписанная поверхность больше не получает объявлений", async () => {
  const stopped = listeningSurface();
  const listening = listeningSurface();
  stopped.stop();

  announceBillingContactVerified();

  // Доставка состоялась: это видно по слушающей поверхности, а не по выжданному сроку.
  await listening.received;
  expect(stopped.deliveries()).toBe(0);
  listening.stop();
});
