import type {
  NotificationEvent,
  Binding,
  DeliveryCommand,
} from "../domain/notification-wire.js";
import type { NotificationLane } from "../../../infrastructure/notification-transport/wire.js";

/** Producers resolve their own durable occurrence. Broker data alone never authorizes a send. */
export type NotificationSource =
  | { readonly status: "unavailable" | "superseded" }
  | {
      readonly status: "current";
      readonly event: NotificationEvent;
      readonly content: DeliveryCommand["content"];
      readonly accountId: string | null;
      readonly title: string;
      readonly readerPath: string;
      readonly purchaseRef?: string;
      readonly amountMinor?: number;
      readonly dueAt?: string;
    };
export interface NotificationSources {
  canReadAccounts?(
    accountIds: readonly string[],
    sourceRef: string,
  ): Promise<ReadonlyMap<string, "allowed" | "denied" | "unavailable">>;
  resolve(event: NotificationEvent): Promise<NotificationSource>;
  canRead(
    accountId: string,
    sourceRef: string,
  ): Promise<"allowed" | "denied" | "unavailable">;
}
export interface NotificationRecipients {
  bindings?(
    accountIds: readonly string[],
    source?: NotificationSource,
  ): Promise<
    ReadonlyMap<
      string,
      {
        readonly email: PromiseSettledResult<Binding | null>;
        readonly telegram: PromiseSettledResult<Binding | null>;
      }
    >
  >;
  enumerate(query: {
    occurredAt: Date;
    after: string | null;
    limit: number;
  }): Promise<readonly string[]>;
  exists(accountId: string): Promise<boolean>;
  binding(
    accountId: string,
    channel: "email" | "telegram",
    source?: NotificationSource,
  ): Promise<Binding | null>;
  email(
    binding: Extract<Binding, { channel: "email" }>,
  ): Promise<string | null>;
}
export type EmailOutcome =
  | { readonly state: "sent" }
  | { readonly state: "unknown" }
  | {
      readonly state: "failed";
      readonly reason: "recipient_unreachable" | "provider_rejected";
    }
  | { readonly state: "not_sent"; readonly retryAfterMs: number };
export type SendNotificationEmail = (message: {
  readonly email: string;
  readonly text: string;
  readonly subject: string;
  readonly operationId: string;
}) => Promise<EmailOutcome>;
/**
 * Карантин входящих. Судьба необрабатываемой строки записывается тем же механизмом, что у
 * транспорта, поэтому расширение аудитории просит его как способность, а не заводит второй.
 */
export type QuarantineNotification = (
  lane: NotificationLane,
  bytes: Buffer,
  reason: string,
) => Promise<void>;
