import type { FastifyInstance } from "fastify";
import type { DrainReport } from "../shared/drain-report.js";

/** Owns actual invoked route work, including handlers whose HTTP client disconnected. */
export class HttpLifetime {
  private readonly active = new Set<Promise<unknown>>();
  private admissionClosed = false;
  private readonly failures: unknown[] = [];
  private stopping: Promise<void> | undefined;
  private drained: Promise<DrainReport> | undefined;

  constructor(private readonly server: FastifyInstance) {
    server.addHook("onRequest", (_request, reply, done) => {
      if (this.admissionClosed) {
        reply.header("Connection", "close").code(503).send({
          error: "Service Unavailable",
          message: "Service Unavailable",
          statusCode: 503,
        });
        return;
      }
      done();
    });
    server.addHook("onRoute", (route) => {
      const handler = route.handler;
      const active = this.active;
      const recordFailure = (error: unknown): void => {
        if (this.admissionClosed) this.failures.push(error);
      };
      route.handler = function (request, reply) {
        const work = Promise.resolve().then(() =>
          handler.call(this, request, reply),
        );
        active.add(work);
        void work.then(
          () => active.delete(work),
          (error: unknown) => {
            recordFailure(error);
            active.delete(work);
          },
        );
        return work;
      };
    });
  }

  closeAdmission(): void {
    this.admissionClosed = true;
  }

  beginStop(): void {
    this.closeAdmission();
    if (this.stopping !== undefined) return;
    try {
      this.stopping = this.server.close().catch((error: unknown) => {
        this.failures.push(error);
      });
    } catch (error: unknown) {
      this.failures.push(error);
      this.stopping = Promise.resolve();
    }
  }

  isQuiescent(): boolean {
    return (
      this.stopping !== undefined &&
      !this.server.server.listening &&
      this.active.size === 0
    );
  }

  drain(): Promise<DrainReport> {
    this.beginStop();
    this.drained ??= this.finish();
    return this.drained;
  }

  async whenQuiescent(): Promise<void> {
    await this.finish();
  }

  private async finish(): Promise<DrainReport> {
    await this.stopping;
    // A failed native close cannot authorize SDK/PG destruction while still listening.
    if (this.server.server.listening) {
      await new Promise<void>((resolve) =>
        this.server.server.once("close", resolve),
      );
    }
    while (this.active.size > 0) await Promise.allSettled([...this.active]);
    return { quiescent: true, failures: [...this.failures] };
  }
}
