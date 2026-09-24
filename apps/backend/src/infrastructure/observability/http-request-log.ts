import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { BackendProcess } from "../../config/platform-config.js";
import { runWithLogContext, writeLog } from "./log.js";

/** Свой идентификатор у каждого запроса: присланный клиентом заголовок не принимается. */
export const generateRequestId = (): string => randomUUID();

/**
 * Даёт каждому запросу контекст журнала и пишет строку о его завершении. Адрес записывается
 * шаблоном маршрута: в самом адресе и его параметрах бывают токены и персональные данные.
 */
export function observeHttpRequests(fastify: FastifyInstance, process: BackendProcess): void {
  const scopes = new WeakMap<FastifyRequest, AsyncResource>();
  fastify.addHook("onRequest", (request, _reply, done) => {
    const route = request.routeOptions.url;
    runWithLogContext(
      { process, requestId: request.id, method: request.method, ...(route === undefined ? {} : { route }) },
      () => {
        const scope = new AsyncResource("inside-http-request");
        scopes.set(request, scope);
        scope.runInAsyncScope(done);
      },
    );
  });
  // Тело запроса читается из событий сокета, и контекст теряется: обработчик получает его обратно.
  fastify.addHook("preValidation", (request, _reply, done) => {
    const scope = scopes.get(request);
    if (scope === undefined) done();
    else scope.runInAsyncScope(done);
  });
  fastify.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions.url;
    // Проверки здоровья опрашивает оркестратор; в журнал попадает только их отказ.
    if (reply.statusCode >= 500 || route === undefined || !route.startsWith("/health")) {
      writeLog("info", "request_completed", {
        process,
        requestId: request.id,
        method: request.method,
        ...(route === undefined ? {} : { route }),
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      });
    }
    done();
  });
}
