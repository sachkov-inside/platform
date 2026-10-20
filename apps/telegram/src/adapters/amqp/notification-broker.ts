import type { DrainReport } from "../../shared/drain-report.js";
import { isTruthy } from "../../shared/truthiness.js";
import {
  connect,
  type ChannelModel,
  type Channel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";
import type { NotificationInbox } from "../../modules/notifications/notification-ports.js";
import type {
  Category,
  NotificationResult,
} from "../../modules/notifications/notification-contract.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";

// Runtime never declares topology: its principal has no configure permissions.
export class NotificationBroker {
  private connection: ChannelModel | undefined;
  private publisher: ConfirmChannel | undefined;
  private consumers: Channel[] = [];
  private pending = new Set<Promise<void>>();
  private healthy = false;
  private closing = false;
  private publishTail: Promise<void> = Promise.resolve();
  private returned = false;
  private terminal = false;
  private opening: Promise<void> | undefined;
  private drained: Promise<DrainReport> | undefined;
  private readonly consumerTags = new Map<Channel, string>();
  private readonly closedChannels = new WeakSet<Channel>();
  private readonly cancelling: Promise<void>[] = [];
  private readonly publications = new Set<Promise<void>>();
  private readonly terminalFailures: unknown[] = [];
  private terminalQuiet!: () => void;
  private readonly terminalQuiescence = new Promise<void>((resolve) => {
    this.terminalQuiet = resolve;
  });
  constructor(
    private readonly url: string,
    private readonly inbox: NotificationInbox,
    private readonly prefetch: number,
    private readonly alert: () => void,
  ) {}
  get connected() {
    return this.healthy;
  }
  open(): Promise<void> {
    if (this.terminal) return Promise.resolve();
    if (this.opening !== undefined) return this.opening;
    const opening = this.openConnection();
    this.opening = opening;
    void opening.then(
      () => {
        this.opening = undefined;
      },
      () => {
        this.opening = undefined;
      },
    );
    return opening;
  }
  private async openConnection(): Promise<void> {
    await this.close();
    if (this.terminal) return;
    this.closing = false;
    const endpoint = new URL(this.url);
    endpoint.searchParams.set("heartbeat", "10");
    const connection = await connect(endpoint.toString(), { timeout: 5000 });
    this.connection = connection;
    connection.on("error", () => this.fail());
    connection.on("close", () => this.fail());
    if (this.terminal) return;
    this.publisher = await connection.createConfirmChannel();
    if (this.terminal) return;
    this.publisher.on("error", () => this.fail());
    this.publisher.on("close", () => this.fail());
    this.publisher.on("return", () => {
      this.returned = true;
    });
    this.healthy = true;
    for (const category of ["subscription", "material"] as const) {
      if (this.terminal) return;
      const channel = await connection.createChannel();
      this.consumers.push(channel);
      channel.on("error", () => this.fail());
      channel.on("close", () => {
        this.closedChannels.add(channel);
        this.fail();
      });
      if (this.terminal) return;
      await channel.prefetch(this.prefetch);
      if (this.terminal) return;
      const consumer = await channel.consume(
        `telegram.notifications.${category}.v1`,
        (message) => {
          if (this.terminal) return;
          if (!message) {
            this.fail();
            return;
          }
          const task = this.accept(channel, message, category);
          this.pending.add(task);
          void task.then(
            () => this.pending.delete(task),
            () => this.pending.delete(task),
          );
        },
        { noAck: false },
      );
      this.consumerTags.set(channel, consumer.consumerTag);
      if (this.terminal) this.cancelConsumer(channel, consumer.consumerTag);
    }
  }
  private async accept(
    channel: Channel,
    message: ConsumeMessage,
    category: Category,
  ): Promise<void> {
    try {
      await this.inbox.receive(
        message.content,
        {
          exchange: message.fields.exchange,
          routingKey: message.fields.routingKey,
          contentType: text(message.properties.contentType),
          type: text(message.properties.type),
          messageId: text(message.properties.messageId),
          persistent: message.properties.deliveryMode === 2,
        },
        category,
      );
      channel.ack(message);
    } catch (error) {
      // Storage/quarantine failure: close consumer, retain unacked work, alert; reconnect has backoff.
      reportFailure("notification.broker-receive", error);
      this.fail();
      if (this.terminal) this.terminalFailures.push(error);
      await channel.close().catch((closeError: unknown) => {
        if (this.terminal) this.terminalFailures.push(closeError);
      });
    }
  }
  publish(result: NotificationResult): Promise<void> {
    const task = this.publishTail.then(() => this.publishOne(result));
    this.publishTail = task.catch(() => undefined);
    this.publications.add(task);
    void task.then(
      () => this.publications.delete(task),
      (error: unknown) => {
        if (this.terminal) this.terminalFailures.push(error);
        this.publications.delete(task);
      },
    );
    return task;
  }
  private async publishOne(result: NotificationResult): Promise<void> {
    const channel = this.publisher;
    if (!channel || !this.healthy)
      throw new Error("Notification broker unavailable");
    this.returned = false;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail();
        reject(new Error("Notification confirm timeout"));
      }, 5000);
      channel.publish(
        "inside.results.telegram.v1",
        "delivery.result",
        Buffer.from(JSON.stringify(result)),
        {
          mandatory: true,
          persistent: true,
          contentType: "application/json",
          type: result.contractVersion,
          messageId: result.messageId,
        },
        (error: unknown) => {
          clearTimeout(timeout);
          if (isTruthy(error) || this.returned)
            reject(new Error("Notification result not confirmed/routed"));
          else resolve();
        },
      );
    });
  }
  private fail() {
    this.healthy = false;
    if (!this.closing) this.alert();
  }
  /** Terminal intake exclusion is distinct from transient reconnect cleanup. */
  beginStop(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.closing = true;
    for (const [channel, tag] of this.consumerTags)
      this.cancelConsumer(channel, tag);
  }
  private cancelConsumer(channel: Channel, tag: string): void {
    this.consumerTags.delete(channel);
    try {
      this.cancelling.push(
        channel
          .cancel(tag)
          .then(() => undefined)
          .catch((error: unknown) => {
            this.terminalFailures.push(error);
          }),
      );
    } catch (error: unknown) {
      this.terminalFailures.push(error);
    }
  }
  isQuiescent(): boolean {
    return (
      this.terminal &&
      this.opening === undefined &&
      this.pending.size === 0 &&
      this.publications.size === 0 &&
      this.connection === undefined
    );
  }
  whenQuiescent(): Promise<void> {
    return this.terminalQuiescence;
  }
  drain(): Promise<DrainReport> {
    this.beginStop();
    this.drained ??= this.finishTerminal();
    return this.drained;
  }
  private async finishTerminal(): Promise<DrainReport> {
    const opened = await Promise.allSettled(
      this.opening === undefined ? [] : [this.opening],
    );
    for (const result of opened)
      if (result.status === "rejected")
        this.terminalFailures.push(result.reason as unknown);
    await Promise.all(this.cancelling);
    // NotificationWorker first stops its result producers, then calls this drain.
    while (this.pending.size > 0 || this.publications.size > 0)
      await Promise.allSettled([...this.pending, ...this.publications]);
    const consumers = this.consumers;
    this.consumers = [];
    for (const channel of consumers) {
      if (this.closedChannels.has(channel)) continue;
      try {
        await channel.close();
      } catch (error: unknown) {
        this.terminalFailures.push(error);
      }
    }
    const publisher = this.publisher;
    this.publisher = undefined;
    if (publisher) {
      try {
        await publisher.close();
      } catch (error: unknown) {
        this.terminalFailures.push(error);
      }
    }
    const connection = this.connection;
    this.connection = undefined;
    if (connection) {
      try {
        await connection.close();
      } catch (error: unknown) {
        this.terminalFailures.push(error);
      }
    }
    this.healthy = false;
    this.terminalQuiet();
    return { quiescent: true, failures: [...this.terminalFailures] };
  }
  async close(): Promise<void> {
    this.closing = true;
    this.healthy = false;
    const connection = this.connection;
    this.connection = undefined;
    this.publisher = undefined;
    for (const c of this.consumers) await c.close().catch(() => undefined);
    this.consumers = [];
    this.consumerTags.clear();
    await Promise.allSettled([...this.pending, this.publishTail]);
    if (connection) await connection.close().catch(() => undefined);
  }
}
// amqplib types message properties as any; the envelope accepts only strings.
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
