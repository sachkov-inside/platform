import { expect, it } from "vitest";

import {
  announceBillingContactVerified,
  subscribeBillingContactVerified,
} from "@/features/billing-contact/model/billing-contact-query";

/** Ждёт одно объявление или сдаётся: молчание не должно висеть до таймаута набора. */
function nextAnnouncement(timeoutMs = 1_000): {
  readonly received: Promise<boolean>;
  readonly stop: () => void;
} {
  let unsubscribe: (() => void) | undefined;
  const received = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    unsubscribe = subscribeBillingContactVerified(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  return {
    received,
    stop: () => {
      unsubscribe?.();
    },
  };
}

it("подтверждение доходит до поверхности, которая его не совершала", async () => {
  const listener = nextAnnouncement();

  announceBillingContactVerified();

  await expect(listener.received).resolves.toBe(true);
  listener.stop();
});

it("отписанная поверхность больше не получает объявлений", async () => {
  const listener = nextAnnouncement(150);
  listener.stop();

  announceBillingContactVerified();

  await expect(listener.received).resolves.toBe(false);
});
