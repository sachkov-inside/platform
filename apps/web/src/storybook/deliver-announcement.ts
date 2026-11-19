import type { FactAnnouncement } from "@/shared/api/fact-announcement";
import { expect } from "storybook/test";

export async function deliverAnnouncement(source: FactAnnouncement) {
  const receipt = Promise.withResolvers<string>();
  const stop = source.subscribe(receipt.resolve);
  try {
    const id = source.announce();
    await expect(await receipt.promise).toBe(id);
  } finally {
    stop();
  }
  // Query cancellation and invalidation finish in promise continuations of the delivery task.
  const { port1, port2 } = new MessageChannel();
  try {
    await new Promise<void>((resolve) => {
      port1.onmessage = () => {
        resolve();
      };
      port2.postMessage(null);
    });
  } finally {
    port1.close();
    port2.close();
  }
}
