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
    publish: (
      _exchange: string,
      _key: string,
      _body: Buffer,
      _options: unknown,
      confirm: (error: unknown) => void,
    ) => {
      publishing.resolve(confirm);
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

it("owns late-acquired publisher error listeners before terminal cleanup", async () => {
  const creating = deferred();
  const channel = deferred<EventEmitter & { close(): Promise<void> }>();
  const publisher = Object.assign(new EventEmitter(), {
    close: () => {
      publisher.emit("error", new Error("synthetic late publisher event"));
      return Promise.resolve();
    },
  });
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: () => {
      creating.resolve();
      return channel.promise;
    },
    createChannel: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  });
  amqp.connect.mockResolvedValueOnce(connection);
  const broker = new NotificationBroker(
    "amqp://synthetic@127.0.0.1",
    {
      receive: () => Promise.resolve(undefined),
    },
    1,
    () => undefined,
  );
  const opened = broker.open();
  await creating.promise;
  broker.beginStop();
  const closing = broker.drain();
  try {
    channel.resolve(publisher);
    await opened;
    expect((await closing).failures).toEqual([]);
    expect(connection.createChannel).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledOnce();
  } finally {
    channel.resolve(publisher);
    await opened;
    await closing;
  }
});

it("settles existing cancellation before rejected receive closes, while drain owns later cancellation", async () => {
  const receiving = deferred<undefined>();
  const firstCancel = deferred();
  const laterCancel = deferred();
  const laterConsume = deferred<{ consumerTag: string }>();
  const laterStarted = deferred();
  const closed = deferred();
  const original = new Error("synthetic receive");
  const cancelError = new Error("synthetic cancellation");
  const closeError = new Error("synthetic close");
  let accept: ((message: unknown) => void) | undefined;
  const consumers = [0, 1].map((index) => {
    const channel = Object.assign(new EventEmitter(), {
      prefetch: () => Promise.resolve(),
      consume: (_queue: string, callback: (message: unknown) => void) => {
        if (index === 0) {
          accept = callback;
          return Promise.resolve({ consumerTag: "first" });
        }
        laterStarted.resolve();
        return laterConsume.promise;
      },
      cancel: vi.fn(() =>
        index === 0 ? firstCancel.promise : laterCancel.promise,
      ),
      ack: vi.fn(),
      close: vi.fn(() => {
        channel.emit("close");
        if (index === 0) {
          closed.resolve();
          return Promise.reject(closeError);
        }
        return Promise.resolve();
      }),
    });
    return channel;
  });
  let index = 0;
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: () =>
      Promise.resolve(
        Object.assign(new EventEmitter(), { close: () => Promise.resolve() }),
      ),
    createChannel: () => Promise.resolve(consumers[index++]),
    close: vi.fn(() => Promise.resolve()),
  });
  amqp.connect.mockResolvedValueOnce(connection);
  const broker = new NotificationBroker(
    "amqp://synthetic@127.0.0.1",
    { receive: () => receiving.promise },
    1,
    () => undefined,
  );
  const opening = broker.open();
  await laterStarted.promise;
  if (accept === undefined) throw new Error("Missing admitted consumer");
  accept({ content: Buffer.from("synthetic"), fields: {}, properties: {} });
  // accept already awaits this exact promise; this later observer runs after its catch.
  const rejected = receiving.promise.catch(() => undefined);
  broker.beginStop();
  const draining = broker.drain();
  try {
    receiving.reject(original);
    await rejected;
    expect(consumers[0]?.close).not.toHaveBeenCalled();
    laterConsume.resolve({ consumerTag: "later" });
    await opening;
    expect(consumers[1]?.cancel).toHaveBeenCalledOnce();
    firstCancel.reject(cancelError);
    await closed.promise;
    // accept owns the earlier snapshot, without waiting for the later cancel.
    expect(connection.close).not.toHaveBeenCalled();
    expect(broker.isQuiescent()).toBe(false);
    laterCancel.resolve();
    const report = await draining;
    expect(report.quiescent).toBe(true);
    expect(
      report.failures.map((error) =>
        error === original
          ? "receive"
          : error === cancelError
            ? "cancel"
            : error === closeError
              ? "close"
              : "unexpected",
      ),
    ).toEqual(["receive", "cancel", "close"]);
    expect(consumers[0]?.ack).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledOnce();
  } finally {
    receiving.reject(original);
    firstCancel.reject(cancelError);
    laterCancel.resolve();
    laterConsume.resolve({ consumerTag: "later" });
    await opening;
    await draining;
  }
});
