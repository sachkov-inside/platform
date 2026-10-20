// deterministic-test-allow unit-io: native owned TCP echo peer and clients verify the test-only gate; finally destroys all sockets and listeners. No Rabbit/PG/native application proof.
import { connect, createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";
import { deferred } from "../support/deferred.js";
import { createTcpOpeningGate } from "../support/tcp-opening-gate.js";

function port(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Owned TCP address unavailable");
  return address.port;
}

for (const outcome of ["released", "closed"] as const)
  it(`owns held native TCP opening until explicit ${outcome}`, async () => {
    let targetConnections = 0;
    const sockets = new Set<Socket>();
    const target = createServer((socket) => {
      targetConnections += 1;
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => undefined);
      socket.pipe(socket);
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    let gate: Awaited<ReturnType<typeof createTcpOpeningGate>> | undefined;
    let client: Socket | undefined;
    try {
      gate = await createTcpOpeningGate({
        host: "127.0.0.1",
        port: port(target),
      });
      client = connect(gate.port, "127.0.0.1");
      client.on("error", () => undefined);
      await gate.admitted;
      expect(gate.acceptedCount()).toBe(1);
      expect(gate.activeCount()).toBe(1);
      expect(targetConnections).toBe(0);
      if (outcome === "released") {
        const reply = once(client, "data");
        client.write("owned-native-gate-probe");
        gate.release();
        const values: readonly unknown[] = await reply;
        const bytes = values[0];
        expect(Buffer.isBuffer(bytes)).toBe(true);
        if (!Buffer.isBuffer(bytes))
          throw new Error("Expected owned native bytes");
        expect(bytes.toString()).toBe("owned-native-gate-probe");
        expect(targetConnections).toBe(1);
      } else {
        const closed = once(client, "close");
        const closing = gate.close();
        expect(gate.close()).toBe(closing);
        await closing;
        await closed;
        gate.release();
        expect(targetConnections).toBe(0);
      }
    } finally {
      client?.destroy();
      await gate?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        target.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      if (gate !== undefined) expect(gate.activeCount()).toBe(0);
    }
  });

for (const phase of ["before_opening", "after_opening"] as const)
  it(`withholds native echo response while outbound bytes reach the peer (${phase})`, async () => {
    const entered = deferred();
    let arrivals = 0;
    const sockets = new Set<Socket>();
    const target = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => undefined);
      socket.on("data", () => {
        arrivals += 1;
        if (arrivals === (phase === "after_opening" ? 2 : 1)) entered.resolve();
      });
      socket.pipe(socket);
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    let gate: Awaited<ReturnType<typeof createTcpOpeningGate>> | undefined;
    let client: Socket | undefined;
    try {
      gate = await createTcpOpeningGate({
        host: "127.0.0.1",
        port: port(target),
      });
      client = connect(gate.port, "127.0.0.1");
      client.on("error", () => undefined);
      await gate.admitted;
      if (phase === "after_opening") {
        gate.release();
        const warm = once(client, "data");
        client.write("owned-warm");
        await warm;
      }
      let received = false;
      client.once("data", () => {
        received = true;
      });
      const reply = once(client, "data");
      gate.holdInbound();
      gate.release();
      client.write("owned-held-inbound-probe");
      await entered.promise;
      // deterministic-test-allow duration-wait: absence observation during an explicit native inbound hold; not a throughput or quiescence verdict.
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(received).toBe(false);
      gate.releaseInbound();
      gate.releaseInbound();
      const values: readonly unknown[] = await reply;
      const bytes = values[0];
      if (!Buffer.isBuffer(bytes))
        throw new Error("Expected owned native echo bytes");
      expect(bytes.toString()).toBe("owned-held-inbound-probe");
    } finally {
      client?.destroy();
      try {
        await gate?.close();
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
          target.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        );
      }
    }
  });
