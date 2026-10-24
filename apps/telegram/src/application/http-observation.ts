import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  TelegramHttpObservability,
  TelegramHttpObservation,
} from "../observability/http-observability.js";

/** Install before the closing admission gate. Handler lifetime remains owned by HttpLifetime. */
export function installTelegramHttpObservation(
  server: FastifyInstance,
  telemetry: TelegramHttpObservability,
): void {
  const observations = new WeakMap<
    FastifyRequest,
    {
      observation: TelegramHttpObservation;
      finish(
        outcome: "completed" | "aborted",
        status: number | undefined,
      ): void;
    }
  >();
  server.addHook("onRequest", (request, reply, done) => {
    const observation = telemetry.startHttp(
      request.method,
      request.routeOptions.url ?? "_OTHER",
    );
    let finished = false;
    const finish = (
      outcome: "completed" | "aborted",
      status: number | undefined,
    ): void => {
      if (finished) return;
      finished = true;
      request.raw.removeListener("aborted", aborted);
      reply.raw.removeListener("close", closed);
      observation.finish({
        outcome,
        ...(status === undefined ? {} : { status }),
      });
    };
    const aborted = (): void =>
      finish("aborted", reply.raw.headersSent ? reply.statusCode : undefined);
    const closed = (): void =>
      finish(
        reply.raw.writableFinished ? "completed" : "aborted",
        reply.raw.headersSent ? reply.statusCode : undefined,
      );
    observations.set(request, { observation, finish });
    request.raw.once("aborted", aborted);
    reply.raw.once("close", closed);
    done();
  });
  server.addHook("onResponse", (request, reply, done) => {
    observations.get(request)?.finish("completed", reply.statusCode);
    done();
  });
  server.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = function (request, reply) {
      const observation = observations.get(request)?.observation;
      return observation === undefined
        ? handler.call(this, request, reply)
        : observation.run(() =>
            Promise.resolve(handler.call(this, request, reply)),
          );
    };
  });
}
