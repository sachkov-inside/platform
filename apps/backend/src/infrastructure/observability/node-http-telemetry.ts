import { runWithLogContext, type LogContext } from "./log.js";
import { context } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  TechnicalTelemetry,
  HttpObservation,
} from "./technical-telemetry.js";

/** Owns one Node HTTP terminal lifecycle; the caller supplies an allowlisted route template. */
export function observeNodeHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  telemetry: TechnicalTelemetry,
  scope: LogContext,
): HttpObservation {
  const observation = telemetry.startHttp({
    method: request.method ?? "GET",
    ...(scope.route === undefined ? {} : { route: scope.route }),
  });
  const began = performance.now();
  const socket = request.socket;
  const finish = (
    status: number | undefined,
    outcome: "completed" | "aborted" | "timeout",
  ) => {
    observation.finish(status, performance.now() - began, outcome);
    request.removeListener("close", onRequestClose);
    response.removeListener("finish", onFinish);
    response.removeListener("close", onResponseClose);
    socket.removeListener("timeout", onTimeout);
  };
  const onRequestClose = () => {
    if (!request.complete) finish(undefined, "aborted");
  };
  const onFinish = () => finish(response.statusCode, "completed");
  const onResponseClose = () => {
    if (!response.writableFinished) finish(undefined, "aborted");
  };
  const onTimeout = () => finish(undefined, "timeout");
  request.once("close", onRequestClose);
  response.once("finish", onFinish);
  response.once("close", onResponseClose);
  socket.once("timeout", onTimeout);
  return {
    ...observation,
    run: (work) =>
      observation.run(() =>
        runWithLogContext(scope, () => {
          context.bind(context.active(), request);
          context.bind(context.active(), response);
          return work();
        }),
      ),
  };
}
