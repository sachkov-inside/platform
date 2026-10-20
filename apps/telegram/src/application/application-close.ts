import { rejectFailures, type DrainReport } from "../shared/drain-report.js";

/** Application composition ports. Each quiescence barrier belongs to its actual resource owner. */
export interface ProducerLifetime {
  beginStop(): void;
  drain(): Promise<DrainReport>;
  whenQuiescent(): Promise<void>;
  isQuiescent(): boolean;
}

export interface TelegramCloseResources {
  readonly http: ProducerLifetime;
  readonly background: ProducerLifetime;
  readonly notifications: ProducerLifetime;
  readonly actions: {
    drain(): Promise<DrainReport>;
    whenQuiescent(): Promise<void>;
  };
  readonly telemetry: () => Promise<void>;
  readonly database: () => Promise<void>;
  readonly framework: () => Promise<void>;
}

/** Sole ordered close executor for the composed Telegram process. */
export class ApplicationClose {
  private closing: Promise<void> | undefined;

  constructor(private readonly resources: TelegramCloseResources) {}

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const closing = new Promise<void>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    // Abort listeners may call close synchronously from beginStop.
    this.closing = closing;
    void this.finish().then(resolve, reject);
    return closing;
  }

  private async finish(): Promise<void> {
    const producers = [
      this.resources.http,
      this.resources.background,
      this.resources.notifications,
    ];
    const stages: unknown[][] = producers.map(() => []);
    // Admission closes synchronously for every independent producer before any await.
    for (const [index, owner] of producers.entries()) {
      try {
        owner.beginStop();
      } catch (error: unknown) {
        stages[index]?.push(error);
      }
    }
    const results = await Promise.allSettled(
      producers.map((owner) => Promise.resolve().then(() => owner.drain())),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled")
        stages[index]?.push(...result.value.failures);
      else stages[index]?.push(result.reason as unknown);
    }
    // A rejected drain wrapper cannot substitute for its independent actual-work barrier.
    // These owner methods fulfill only at closed admission and actual active-zero.
    await Promise.all(producers.map((owner) => owner.whenQuiescent()));
    const failures = stages.flat();
    try {
      const actions = await this.resources.actions.drain();
      failures.push(...actions.failures);
    } catch (error: unknown) {
      failures.push(error);
    }
    await this.resources.actions.whenQuiescent();
    for (const close of [
      this.resources.telemetry,
      this.resources.database,
      this.resources.framework,
    ]) {
      try {
        await close();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    rejectFailures(failures);
  }
}
