import { connect, createServer, type Socket } from "node:net";
import { once } from "node:events";
import { deferred } from "./deferred.js";

/** Test-only transparent opening gate. Owns sockets; no payload inspection/capture, only native buffering/piping. */
export async function createTcpOpeningGate(target: {
  readonly host: string;
  readonly port: number;
}) {
  if (
    !["127.0.0.1", "localhost"].includes(target.host) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65_535
  )
    throw new Error("TCP opening gate requires an owned loopback target");
  const admitted = deferred();
  const sockets = new Map<Socket, Promise<void>>();
  const held = new Set<Socket>();
  const upstreams = new Map<Socket, Socket>();
  const inboundPiped = new Set<Socket>();
  let inboundHeld = false;
  let accepted = 0;
  let released = false;
  let closed = false;
  let closing: Promise<void> | undefined;
  const own = (socket: Socket): void => {
    const stopped = deferred();
    sockets.set(socket, stopped.promise);
    socket.on("error", () => undefined);
    socket.once("close", () => {
      sockets.delete(socket);
      held.delete(socket);
      stopped.resolve();
    });
  };
  const pipeInbound = (upstream: Socket, client: Socket): void => {
    if (
      closed ||
      inboundHeld ||
      inboundPiped.has(upstream) ||
      upstream.destroyed ||
      client.destroyed
    )
      return;
    inboundPiped.add(upstream);
    upstream.pipe(client);
    upstream.resume();
  };
  const forward = (client: Socket): void => {
    held.delete(client);
    if (closed || client.destroyed) return;
    const upstream = connect(target.port, target.host);
    own(upstream);
    upstreams.set(upstream, client);
    upstream.once("connect", () => {
      if (closed || client.destroyed) {
        upstream.destroy();
        return;
      }
      client.pipe(upstream);
      pipeInbound(upstream, client);
      client.resume();
    });
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => {
      upstreams.delete(upstream);
      inboundPiped.delete(upstream);
      client.destroy();
    });
    upstream.once("error", () => client.destroy());
  };
  const server = createServer((client) => {
    own(client);
    if (closed) {
      client.destroy();
      return;
    }
    client.pause();
    accepted += 1;
    held.add(client);
    admitted.resolve();
    if (released) forward(client);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  } catch {
    closed = true;
    for (const socket of sockets.keys()) socket.destroy();
    server.close();
    throw new Error("Owned TCP gate acquisition failed");
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Owned TCP gate address unavailable");
  }
  return {
    port: address.port,
    admitted: admitted.promise,
    acceptedCount: () => accepted,
    activeCount: () => sockets.size,
    release: (): void => {
      if (closed) return;
      released = true;
      for (const client of held) forward(client);
    },
    holdInbound: (): void => {
      if (closed) return;
      inboundHeld = true;
      for (const [upstream, client] of upstreams) {
        upstream.unpipe(client);
        upstream.pause();
        inboundPiped.delete(upstream);
      }
    },
    releaseInbound: (): void => {
      if (closed) return;
      inboundHeld = false;
      for (const [upstream, client] of upstreams) pipeInbound(upstream, client);
    },
    close: (): Promise<void> => {
      if (closing !== undefined) return closing;
      closed = true;
      closing = new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ).then(async () => {
        while (sockets.size > 0) await Promise.all(sockets.values());
      });
      for (const socket of sockets.keys()) socket.destroy();
      return closing;
    },
  };
}
