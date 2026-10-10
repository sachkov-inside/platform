import { expect, it, vi } from "vitest";

import {
  factAnnouncement,
  type FactAnnouncement,
} from "@/shared/api/fact-announcement";

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
  vi.stubGlobal("window", new EventTarget());
  const fact = factAnnouncement("test.fact-announcement.delivered");
  const surface = listeningSurface(fact);

  fact.announce();

  // При работающем канале событие window не дублирует асинхронную доставку.
  expect(surface.deliveries()).toBe(0);
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

it("без межвкладочного канала соседняя поверхность той же вкладки слышит запись", () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", new EventTarget());
  const writer = factAnnouncement("test.fact-announcement.local");
  const reader = factAnnouncement("test.fact-announcement.local");
  const other = factAnnouncement("test.fact-announcement.unrelated-local");
  const surface = listeningSurface(reader);
  const unrelated = listeningSurface(other);

  writer.announce();

  expect(surface.deliveries()).toBe(1);
  expect(unrelated.deliveries()).toBe(0);
  surface.stop();
  writer.announce();
  expect(surface.deliveries()).toBe(1);
  unrelated.stop();
});

for (const transport of ["broadcast", "window"] as const) {
  it(`gives the writer and all subscribers the same write identity through ${transport}`, async () => {
    if (transport === "window") vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("window", new EventTarget());
    const fact = factAnnouncement(
      `test.fact-announcement.identity.${transport}`,
    );
    const identities: string[] = [];
    let delivered: () => void = () => undefined;
    const received = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    const stop = fact.subscribe((identity) => {
      identities.push(identity);
      delivered();
    });
    try {
      const identity = fact.announce();
      await received;
      expect(identities).toEqual([identity]);
    } finally {
      stop();
    }
  });
}

it("continues receiving the legacy written message from a previously opened tab", async () => {
  const fact = factAnnouncement("test.fact-announcement.legacy");
  const surface = listeningSurface(fact);
  const writer = new BroadcastChannel("test.fact-announcement.legacy");
  try {
    writer.postMessage("written");
    await surface.received;
    expect(surface.deliveries()).toBe(1);
  } finally {
    writer.close();
    surface.stop();
  }
});
