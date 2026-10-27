import type { DrainReport } from "../../shared/drain-report.js";

/** Lifetime of detached activation work and every actually started timeout fallback. */
export class ActivationActions {
  private readonly active = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];
  private draining = false;

  track(work: Promise<void>): Promise<void> {
    this.active.add(work);
    void work.then(
      () => this.active.delete(work),
      (error: unknown) => {
        if (this.draining) this.failures.push(error);
        this.active.delete(work);
      },
    );
    return work;
  }

  isQuiescent(): boolean {
    return this.draining && this.active.size === 0;
  }

  /** Call after HTTP/background/AMQP producers are quiet. Descendants remain owned. */
  async drain(): Promise<DrainReport> {
    this.draining = true;
    while (this.active.size > 0) await Promise.allSettled([...this.active]);
    return { quiescent: true, failures: [...this.failures] };
  }
}
