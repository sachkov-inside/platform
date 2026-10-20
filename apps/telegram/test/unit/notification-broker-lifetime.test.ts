import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { deferred } from "../support/deferred.js";
import { NotificationBroker } from "../../src/adapters/amqp/notification-broker.js";

const amqp = vi.hoisted(() => ({ connect: vi.fn() }));
// AMQP is an external system boundary. These controls are not native RabbitMQ evidence.
vi.mock("amqplib", () => ({ connect: amqp.connect }));

afterEach(() => vi.resetAllMocks());

it("does not install consumers when an admitted AMQP connection opens after terminal stop", async () => {
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: vi.fn(),
    createChannel: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  });
  const opening = deferred<typeof connection>();
  amqp.connect.mockReturnValueOnce(opening.promise);
  const broker = new NotificationBroker(
    "amqp://synthetic@127.0.0.1",
    {
      receive: () => Promise.resolve(undefined),
    },
    1,
    () => undefined,
  );
  const started = broker.open();
  // The connect call is a committed admission barrier, not a timed pause.
  await vi.waitFor(() => expect(amqp.connect).toHaveBeenCalledOnce());
  broker.beginStop();
  const draining = broker.drain();
  opening.resolve(connection);
  try {
    await started;
    expect(await draining).toEqual({ quiescent: true, failures: [] });
    expect(connection.createConfirmChannel).not.toHaveBeenCalled();
    expect(connection.createChannel).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledOnce();
    await broker.open();
    expect(amqp.connect).toHaveBeenCalledOnce();
  } finally {
    opening.resolve(connection);
    await draining;
  }
});

it("drains admitted receive and original rejected publication before closing AMQP resources", async () => {
  const receiving = deferred();
  const receiveStarted = deferred();
  const publishing = deferred<(error: unknown) => void>();
  const cancelError = new Error("synthetic cancel");
  const channelError = new Error("synthetic channel close");
  const connectionError = new Error("synthetic connection close");
  let callback: ((message: unknown) => void) | undefined;
  const consumers = [0, 1].map((index) =>
    Object.assign(new EventEmitter(), {
      prefetch: () => Promise.resolve(),
      consume: (_queue: string, accept: (message: unknown) => void) => {
        if (index === 0) callback = accept;
        return Promise.resolve({ consumerTag: `synthetic-${index}` });
      },
      cancel: vi.fn(() =>
        index === 0 ? Promise.reject(cancelError) : Promise.resolve(),
      ),
      ack: vi.fn(),
      close: vi.fn(() =>
        index === 0 ? Promise.reject(channelError) : Promise.resolve(),
      ),
    }),
  );
  const publisher = Object.assign(new EventEmitter(), {
    publish: (...args: unknown[]) => {
      const confirm = args[4];
      if (typeof confirm !== "function")
        throw new Error("Missing confirm callback");
      publishing.resolve((error: unknown) => confirm(error));
    },
    close: vi.fn(() => Promise.resolve()),
  });
  let index = 0;
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: () => Promise.resolve(publisher),
    createChannel: () => Promise.resolve(consumers[index++]),
    close: vi.fn(() => Promise.reject(connectionError)),
  });
  amqp.connect.mockResolvedValueOnce(connection);
  const inbox = {
    receive: vi.fn(async () => {
      receiveStarted.resolve();
      await receiving.promise;
      return undefined;
    }),
  };
  const broker = new NotificationBroker(
    "amqp://synthetic@127.0.0.1",
    inbox,
    1,
    () => undefined,
  );
  await broker.open();
  const message = {
    content: Buffer.from("synthetic"),
    fields: { exchange: "synthetic", routingKey: "synthetic" },
    properties: {},
  };
  if (callback === undefined) throw new Error("Missing admitted consumer");
  callback(message);
  await receiveStarted.promise;
  const publication = broker.publish({
    contractVersion: "inside.notification-result.v1",
    state: "accepted",
    messageId: "synthetic-message",
    operationId: "synthetic-operation",
    deliveryRef: "synthetic-delivery",
    commandRevision: 1,
    payloadDigest: "synthetic-digest",
    resultRevision: 1,
    channel: "telegram",
    recordedAt: "2026-10-07T00:00:00.000Z",
  });
  // Preserve the actual rejected promise, independently of the broker's normalized tail.
  const observedPublication = publication.catch((error: unknown) => error);
  const confirm = await publishing.promise;
  broker.beginStop();
  callback(message);
  const draining = broker.drain();
  try {
    expect(inbox.receive).toHaveBeenCalledOnce();
    expect(consumers[0]?.ack).not.toHaveBeenCalled();
    expect(publisher.close).not.toHaveBeenCalled();
    receiving.resolve();
    confirm(new Error("synthetic publish"));
    const publishError: unknown = await observedPublication;
    const report = await draining;
    expect(report.quiescent).toBe(true);
    expect(consumers[0]?.ack).toHaveBeenCalledOnce();
    expect(report.failures).toContain(publishError);
    expect(report.failures).toContain(cancelError);
    expect(report.failures).toContain(channelError);
    expect(report.failures).toContain(connectionError);
    expect(report.failures).toHaveLength(4);
    expect(publisher.close).toHaveBeenCalledOnce();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(broker.isQuiescent()).toBe(true);
    expect(broker.drain()).toBe(draining);
  } finally {
    receiving.resolve();
    confirm(null);
    await observedPublication;
    await draining;
  }
});
