import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { BackendProcess } from "../../config/platform-config.js";
import type {
  HttpObservation,
  TechnicalTelemetry,
} from "./technical-telemetry.js";
import { runWithLogContext, writeLog } from "./log.js";

/** Свой идентификатор у каждого запроса: присланный клиентом заголовок не принимается. */
export const generateRequestId = (): string => randomUUID();

/**
 * Даёт каждому запросу контекст журнала и пишет строку о его завершении. Адрес записывается
 * шаблоном маршрута: в самом адресе и его параметрах бывают токены и персональные данные.
 */
export function observeHttpRequests(
  fastify: FastifyInstance,
  process: BackendProcess,
  telemetry?: TechnicalTelemetry,
): void {
  const scopes = new WeakMap<FastifyRequest, AsyncResource>();
  const observations = new WeakMap<FastifyRequest, HttpObservation>();
  const started = new WeakMap<FastifyRequest, number>();
  const interrupted = (
    request: FastifyRequest,
    outcome: "aborted" | "timeout",
  ) => {
    const begin = started.get(request);
    if (begin !== undefined)
      observations
        .get(request)
        ?.finish(undefined, performance.now() - begin, outcome);
  };
  fastify.addHook("onRequest", (request, reply, done) => {
    started.set(request, performance.now());
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) interrupted(request, "aborted");
    });
    const route = request.routeOptions.url;
    const observation = telemetry?.startHttp({
      method: request.method,
      ...(route === undefined ? {} : { route }),
    });
    if (observation !== undefined) observations.set(request, observation);
    const enter = () =>
      runWithLogContext(
        {
          process,
          requestId: request.id,
          method: request.method,
          ...(route === undefined ? {} : { route }),
        },
        () => {
          const scope = new AsyncResource("inside-http-request");
          scopes.set(request, scope);
          scope.runInAsyncScope(done);
        },
      );
    if (observation === undefined) enter();
    else observation.run(enter);
  });
  // Тело запроса читается из событий сокета, и контекст теряется: обработчик получает его обратно.
  fastify.addHook("preValidation", (request, _reply, done) => {
    const scope = scopes.get(request);
    if (scope === undefined) done();
    else scope.runInAsyncScope(done);
  });
  fastify.addHook("onRequestAbort", (request, done) => {
    interrupted(request, "aborted");
    done();
  });
  fastify.addHook("onTimeout", (request, _reply, done) => {
    interrupted(request, "timeout");
    done();
  });
  fastify.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions.url;
    observations.get(request)?.finish(reply.statusCode, reply.elapsedTime);
    // Проверки здоровья опрашивает оркестратор; в журнал попадает только их отказ.
    if (
      reply.statusCode >= 500 ||
      route === undefined ||
      !route.startsWith("/health")
    ) {
      writeLog("info", "request_completed", {
        process,
        requestId: request.id,
        method: request.method,
        ...(route === undefined ? {} : { route }),
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        // Caddy strips this marker from non-loopback peers; a bank payload is never a probe.
        ...(process === "api" &&
        reply.statusCode === 400 &&
        request.method === "POST" &&
        route === "/billing/tbank/notification" &&
        request.body === undefined &&
        request.headers["x-inside-production-verify"] ===
          "bank-webhook-rejection"
          ? { probe: "production_verify" }
          : {}),
      });
    }
    done();
  });
}
