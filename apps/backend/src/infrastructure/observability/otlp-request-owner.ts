import type { Agent, ClientRequest } from "node:http";
import type { Socket } from "node:net";

import { TELEMETRY_EXPORT_TIMEOUT_MS } from "./technical-telemetry-policy.js";

/** Own only the agents supplied to one pinned OTLP exporter, including lazy initialization. */
export function createOtlpRequestOwner() {
  const agents = new Map<string, Promise<Agent>>();
  const requests = new Map<ClientRequest, Promise<void>>();
  const sockets = new Map<Socket, Promise<void>>();
  let closing: Promise<void> | undefined;

  const factory = (protocol: string): Promise<Agent> => {
    if (closing !== undefined)
      return Promise.reject(new Error("Telemetry transport closed"));
    if (protocol !== "http:" && protocol !== "https:")
      return Promise.reject(new Error("Unsupported telemetry protocol"));
    const existing = agents.get(protocol);
    if (existing !== undefined) return existing;
    // Import after entrypoint instrumentation. The SDK factory can be called
    // concurrently before its own lazy transport cache is populated.
    const pending = (async () => {
      const http = await import("node:http");
      const module = protocol === "http:" ? http : await import("node:https");
      const agent = new module.Agent({ keepAlive: true });
      // Node26.10 lib/_http_agent.js supplies this hook, but its API docs and
      // @types/node26 omit it. Guard the pinned runtime shape; never patch a
      // global/prototype or pretend this is a documented Node extension point.
      if (!("addRequest" in agent) || typeof agent.addRequest !== "function") {
        agent.destroy();
        throw new Error("Unsupported telemetry agent");
      }
      const addRequest = agent.addRequest;
      Object.defineProperty(agent, "addRequest", {
        configurable: true,
        value: (...args: unknown[]) => {
          const request = args[0];
          if (!(request instanceof http.ClientRequest))
            throw new Error("Unsupported telemetry request");
          if (closing !== undefined)
            throw new Error("Telemetry transport closed");
          let complete: () => void = () => undefined;
          const closed = new Promise<void>((resolve) => {
            complete = resolve;
          });
          requests.set(request, closed);
          // This is an absolute request lifetime, not socket inactivity. It
          // physically destroys even a continuously streaming 200 response.
          const deadline = setTimeout(
            () => request.destroy(new Error("Request timed out")),
            TELEMETRY_EXPORT_TIMEOUT_MS,
          );
          const clear = () => clearTimeout(deadline);
          request.once("error", clear);
          const finish = () => {
            clear();
            request.removeListener("error", clear);
            request.removeListener("close", finish);
            requests.delete(request);
            complete();
          };
          request.once("close", finish);
          const observeSocket = (socket: Socket) => {
            if (sockets.has(socket)) return;
            const closedSocket = new Promise<void>((resolve) =>
              socket.once("close", () => {
                sockets.delete(socket);
                resolve();
              }),
            );
            sockets.set(socket, closedSocket);
          };
          request.once("socket", observeSocket);
          try {
            const result: unknown = Reflect.apply(addRequest, agent, args);
            return result;
          } catch (error) {
            clear();
            request.destroy();
            // A constructor that throws synchronously never returns the request
            // to the SDK and Node does not emit its close event.
            request.removeListener("socket", observeSocket);
            finish();
            throw error;
          }
        },
      });
      return agent;
    })();
    agents.set(protocol, pending);
    return pending;
  };

  const shutdown = (): Promise<void> => {
    closing ??= (async () => {
      const initialized = await Promise.allSettled(agents.values());
      for (const request of requests.keys()) request.destroy();
      for (const result of initialized)
        if (result.status === "fulfilled") result.value.destroy();
      // Agent.destroy() initiates socket close; await actual native resource
      // completion as the SDK transport's shutdown itself is a no-op.
      await Promise.all([...requests.values(), ...sockets.values()]);
    })();
    return closing;
  };
  return { factory, shutdown };
}
