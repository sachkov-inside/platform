import { setTimeout as delay } from "node:timers/promises";

// Polls until the check stops throwing. The budget belongs to the caller: it must exceed the
// slowest retry the production code under test is allowed to take, or the test measures load.
export async function eventually(
  check: () => Promise<void>,
  budgetMs: number,
): Promise<void> {
  // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
      if (Date.now() >= deadline) throw error;
      // deterministic-test-allow duration-wait: Poll a caller-supplied durable fact; the delay is only the sampling interval.
      await delay(50);
    }
  }
}
