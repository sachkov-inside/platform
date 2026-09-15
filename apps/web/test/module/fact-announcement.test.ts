import { expect, it } from "vitest";

import { factAnnouncement, type FactAnnouncement } from "@/shared/api/fact-announcement";

/**
 * Поверхность, слушающая объявления. Её первое получение — тот факт, на котором заканчивается
 * ожидание: пауза по длительности мерила бы машину, а не доставку.
 */
function listeningSurface(announcement: FactAnnouncement): {
  readonly received: Promise<void>;
  readonly deliveries: () => number;
  readonly stop: () => void;
} {
  let deliveries = 0;
  let deliver: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  const unsubscribe = announcement.subscribe(() => {
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

it("запись доходит до поверхности, которая её не совершала", async () => {
  const fact = factAnnouncement("test.fact-announcement.delivered");
  const surface = listeningSurface(fact);

  fact.announce();

  await surface.received;
  expect(surface.deliveries()).toBe(1);
  surface.stop();
});

it("отписанная поверхность больше не получает объявлений", async () => {
  const fact = factAnnouncement("test.fact-announcement.unsubscribed");
  const stopped = listeningSurface(fact);
  const listening = listeningSurface(fact);
  stopped.stop();

  fact.announce();

  // Доставка состоялась: это видно по слушающей поверхности, а не по выжданному сроку.
  await listening.received;
  expect(stopped.deliveries()).toBe(0);
  listening.stop();
});

it("запись одного факта не сбрасывает чтение другого", async () => {
  const written = factAnnouncement("test.fact-announcement.written");
  const other = factAnnouncement("test.fact-announcement.other");
  const unrelated = listeningSurface(other);
  const listening = listeningSurface(written);

  written.announce();

  await listening.received;
  expect(unrelated.deliveries()).toBe(0);
  unrelated.stop();
  listening.stop();
});
