import type { WaitlistConfirmation } from "@inside/contracts/waitlist-confirmation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Prisma,
  lockProductWaitlistOperation,
  lockProductWaitlistMembership,
  lockTelegramAccountBinding,
  type SalesFunnelPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";

const joinSchema = z.strictObject({
  operationId: z.uuid().toLowerCase(),
  intakeId: z.uuid().toLowerCase(),
  source: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .nullable(),
});
const weeksSchema = z.array(
  z.object({
    from: z.string(),
    joined: z.coerce.number().int().nonnegative(),
    withdrawn: z.coerce.number().int().nonnegative(),
  }),
);
const fail = <
  Code extends
    | "invalid_request"
    | "intake_not_found"
    | "audience_too_large"
    | "telegram_required"
    | "dependency_unavailable",
>(
  code: Code,
) => ({ ok: false, error: { code } }) as const;
export class ProductWaitlists {
  constructor(
    private readonly dependencies: {
      readonly prisma: SalesFunnelPrismaClient;
      readonly links: Pick<TelegramAccountLinks, "readBinding">;
      readonly clock: () => Date;
    },
  ) {}
  /** Complete bounded notification audience. Never silently truncate active memberships. */
  async notificationAudience(intakeId: string) {
    if (!z.uuid().safeParse(intakeId).success) return fail("invalid_request");
    try {
      return await this.dependencies.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`,
        );
        const intake = await tx.productWaitlistIntake.findUnique({
          where: { id: intakeId },
        });
        if (intake === null) return fail("intake_not_found");
        const rows = await tx.productWaitlistMembership.findMany({
          where: { intakeId, active: true },
          select: { accountId: true },
          orderBy: { accountId: "asc" },
          take: 10001,
        });
        if (rows.length > 10000) return fail("audience_too_large");
        return {
          ok: true,
          value: {
            productId: intake.productId,
            accountIds: rows.map((row) => row.accountId),
          },
        } as const;
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "notificationAudience" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
  async notificationMembership(intakeId: string, accountId: string) {
    if (
      !z.uuid().safeParse(intakeId).success ||
      !z.uuid().safeParse(accountId).success
    )
      return fail("invalid_request");
    try {
      return await this.dependencies.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`,
        );
        const intake = await tx.productWaitlistIntake.findUnique({
          where: { id: intakeId },
        });
        if (intake === null) return fail("intake_not_found");
        const membership = await tx.productWaitlistMembership.findUnique({
          where: { intakeId_accountId: { intakeId, accountId } },
        });
        return {
          ok: true,
          value: {
            productId: intake.productId,
            active: membership?.active === true,
          },
        } as const;
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "notificationMembership" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
  async readIntake(productId: string) {
    if (!z.uuid().safeParse(productId).success) return fail("invalid_request");
    try {
      const intake =
        await this.dependencies.prisma.productWaitlistIntake.findFirst({
          where: { productId, accepting: true },
        });
      return intake === null
        ? fail("intake_not_found")
        : ({
            ok: true,
            value: { intakeId: intake.id, name: intake.name },
          } as const);
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "readWaitlistIntake" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
  async read(accountId: string, productId: string) {
    if (
      !z.uuid().safeParse(accountId).success ||
      !z.uuid().safeParse(productId).success
    )
      return fail("invalid_request");
    try {
      const intake =
        await this.dependencies.prisma.productWaitlistIntake.findFirst({
          where: { productId, accepting: true },
        });
      if (intake === null) return fail("intake_not_found");
      const membership =
        await this.dependencies.prisma.productWaitlistMembership.findUnique({
          where: { intakeId_accountId: { intakeId: intake.id, accountId } },
        });
      return {
        ok: true,
        value: {
          intakeId: intake.id,
          name: intake.name,
          active: membership?.active ?? false,
        },
      } as const;
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "readWaitlist" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
  async join(accountId: string, input: unknown) {
    const parsed = joinSchema.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(accountId).success)
      return fail("invalid_request");
    try {
      return await this.dependencies.prisma.$transaction(async (tx) => {
        await lockTelegramAccountBinding(tx, accountId);
        const binding = await this.dependencies.links.readBinding(
          { accountId },
          tx,
        );
        if (!binding.ok) return fail("dependency_unavailable");
        if (
          binding.binding?.accountRef == null ||
          binding.binding.telegramIdentityRef === null
        )
          return fail("telegram_required");
        await lockProductWaitlistOperation(tx, parsed.data.operationId);
        await lockProductWaitlistMembership(
          tx,
          parsed.data.intakeId,
          accountId,
        );
        const intake = await tx.productWaitlistIntake.findUnique({
          where: { id: parsed.data.intakeId },
        });
        if (intake === null || !intake.accepting)
          return fail("intake_not_found");
        const key = { intakeId: intake.id, accountId };
        const previous = await tx.productWaitlistMembership.findUnique({
          where: { intakeId_accountId: key },
        });
        const receipt = await tx.productWaitlistOperation.findUnique({
          where: { id: parsed.data.operationId },
        });
        if (receipt !== null) {
          if (
            receipt.accountId !== accountId ||
            receipt.intakeId !== intake.id ||
            receipt.source !== parsed.data.source
          )
            return fail("invalid_request");
          return {
            ok: true,
            value: {
              intakeId: intake.id,
              name: intake.name,
              active: previous?.active ?? false,
            },
          } as const;
        }
        await tx.productWaitlistOperation.create({
          data: {
            id: parsed.data.operationId,
            ...key,
            source: parsed.data.source,
            createdAt: this.dependencies.clock(),
          },
        });
        if (previous?.active === true)
          return {
            ok: true,
            value: { intakeId: intake.id, name: intake.name, active: true },
          } as const;
        const now = this.dependencies.clock();
        const eventId = randomUUID();
        await tx.productWaitlistMembership.upsert({
          where: { intakeId_accountId: key },
          create: {
            ...key,
            confirmationEventId: eventId,
            active: true,
            source: parsed.data.source,
            joinedAt: now,
            updatedAt: now,
          },
          update: {
            confirmationEventId: eventId,
            active: true,
            source: parsed.data.source,
            joinedAt: now,
            updatedAt: now,
          },
        });
        await tx.productWaitlistEvent.create({
          data: {
            id: eventId,
            ...key,
            kind: "joined",
            source: parsed.data.source,
            occurredAt: now,
          },
        });
        await tx.productWaitlistConfirmation.create({
          data: {
            eventId,
            ...key,
            accountRef: binding.binding.accountRef,
            telegramIdentityRef: binding.binding.telegramIdentityRef,
            linkRevision: binding.binding.linkRevision,
            createdAt: now,
          },
        });
        return {
          ok: true,
          value: { intakeId: intake.id, name: intake.name, active: true },
        } as const;
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "joinWaitlist" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
  /** Relays only committed occurrences. HTTP acceptance is idempotent; lost replies retain the same event ID. */
  async dispatchConfirmations(
    deliver: (
      command: WaitlistConfirmation,
    ) => Promise<"accepted" | "suppressed" | "unavailable">,
    limit = 20,
  ): Promise<number> {
    const rows =
      await this.dependencies.prisma.productWaitlistConfirmation.findMany({
        where: { completedAt: null },
        orderBy: [{ createdAt: "asc" }, { eventId: "asc" }],
        take: limit,
      });
    let completed = 0;
    for (const row of rows) {
      const command: WaitlistConfirmation = {
        contractVersion: "inside.waitlist-confirmation.v1",
        eventId: row.eventId,
        intakeId: row.intakeId,
        accountRef: row.accountRef,
        telegramIdentityRef: row.telegramIdentityRef,
        linkRevision: row.linkRevision,
      };
      const current = await this.confirmationCurrent(command);
      if (current === "unavailable") continue;
      const result =
        current === "suppressed" ? "suppressed" : await deliver(command);
      if (result === "unavailable") continue;
      await this.dependencies.prisma.productWaitlistConfirmation.updateMany({
        where: { eventId: row.eventId, completedAt: null },
        data: { completedAt: this.dependencies.clock() },
      });
      completed += 1;
    }
    return completed;
  }
  /** Dispatch authorization binds the current membership generation and current Telegram link. */
  async confirmationCurrent(
    command: WaitlistConfirmation,
  ): Promise<"accepted" | "suppressed" | "unavailable"> {
    try {
      return await this.dependencies.prisma.$transaction(async (tx) => {
        const row = await tx.productWaitlistConfirmation.findUnique({
          where: { eventId: command.eventId },
        });
        if (
          row === null ||
          row.intakeId !== command.intakeId ||
          row.accountRef !== command.accountRef ||
          row.telegramIdentityRef !== command.telegramIdentityRef ||
          row.linkRevision !== command.linkRevision
        )
          return "suppressed";
        await lockTelegramAccountBinding(tx, row.accountId);
        await lockProductWaitlistMembership(tx, row.intakeId, row.accountId);
        const membership = await tx.productWaitlistMembership.findUnique({
          where: {
            intakeId_accountId: {
              intakeId: row.intakeId,
              accountId: row.accountId,
            },
          },
        });
        const binding = await this.dependencies.links.readBinding(
          { accountId: row.accountId },
          tx,
        );
        if (!binding.ok) return "unavailable";
        return membership?.active === true &&
          membership.confirmationEventId === row.eventId &&
          binding.binding?.accountRef === row.accountRef &&
          binding.binding.telegramIdentityRef === row.telegramIdentityRef &&
          binding.binding.linkRevision === row.linkRevision
          ? "accepted"
          : "suppressed";
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "confirmationCurrent" },
        error,
        "unavailable" as const,
      );
    }
  }
  async withdraw(accountId: string, input: unknown) {
    const parsed = z
      .strictObject({ intakeId: z.uuid().toLowerCase() })
      .safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(accountId).success)
      return fail("invalid_request");
    try {
      return await this.dependencies.prisma.$transaction(async (tx) => {
        await lockProductWaitlistMembership(
          tx,
          parsed.data.intakeId,
          accountId,
        );
        const intake = await tx.productWaitlistIntake.findUnique({
          where: { id: parsed.data.intakeId },
        });
        if (intake === null) return fail("intake_not_found");
        const key = { intakeId: intake.id, accountId };
        const previous = await tx.productWaitlistMembership.findUnique({
          where: { intakeId_accountId: key },
        });
        if (previous?.active === true) {
          const now = this.dependencies.clock();
          await tx.productWaitlistMembership.update({
            where: { intakeId_accountId: key },
            data: { active: false, updatedAt: now },
          });
          await tx.productWaitlistEvent.create({
            data: {
              id: randomUUID(),
              ...key,
              kind: "withdrawn",
              source: previous.source,
              occurredAt: now,
            },
          });
        }
        return {
          ok: true,
          value: { intakeId: intake.id, name: intake.name, active: false },
        } as const;
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "withdrawWaitlist" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
  async demand(query: {
    readonly productId: string;
    readonly from: Date;
    readonly to: Date;
  }) {
    try {
      return await this.dependencies.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`,
        );
        const intake = await tx.productWaitlistIntake.findFirst({
          where: { productId: query.productId, accepting: true },
        });
        if (intake === null) return { ok: true, value: null } as const;
        const memberships = await tx.productWaitlistMembership.groupBy({
          by: ["source"],
          where: { intakeId: intake.id, active: true },
          _count: true,
        });
        const events = await tx.productWaitlistEvent.groupBy({
          by: ["source", "kind"],
          where: {
            intakeId: intake.id,
            occurredAt: { gte: query.from, lt: query.to },
          },
          _count: true,
        });
        const sources = new Map<
          string | null,
          {
            source: string | null;
            active: number;
            joined: number;
            withdrawn: number;
          }
        >();
        const row = (source: string | null) => {
          let value = sources.get(source);
          if (value === undefined) {
            value = { source, active: 0, joined: 0, withdrawn: 0 };
            sources.set(source, value);
          }
          return value;
        };
        for (const group of memberships)
          row(group.source).active = group._count;
        for (const group of events) {
          if (group.kind === "joined") row(group.source).joined = group._count;
          else row(group.source).withdrawn = group._count;
        }
        const weeks = weeksSchema.parse(
          await tx.$queryRaw(Prisma.sql`
      SELECT to_char(date_trunc('week', occurred_at AT TIME ZONE 'Europe/Moscow'),'YYYY-MM-DD') AS from,
      count(*) FILTER(WHERE kind='joined')::int AS joined,
      count(*) FILTER(WHERE kind='withdrawn')::int AS withdrawn
      FROM sales_funnel.product_waitlist_events WHERE intake_id=${intake.id}::uuid AND occurred_at>=${query.from} AND occurred_at<${query.to}
      GROUP BY 1 ORDER BY 1
    `),
        );
        const rows = [...sources.values()].sort((a, b) =>
          a.source === null
            ? 1
            : b.source === null
              ? -1
              : a.source.localeCompare(b.source),
        );
        return {
          ok: true,
          value: {
            intakeId: intake.id,
            name: intake.name,
            active: rows.reduce((n, r) => n + r.active, 0),
            joined: rows.reduce((n, r) => n + r.joined, 0),
            withdrawn: rows.reduce((n, r) => n + r.withdrawn, 0),
            sources: rows,
            weeks,
          },
        } as const;
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "readWaitlistDemand" },
        error,
        fail("dependency_unavailable"),
      );
    }
  }
}
