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
const fail = (
  code:
    | "invalid_request"
    | "intake_not_found"
    | "telegram_required"
    | "dependency_unavailable",
) => ({ ok: false, error: { code } }) as const;
export class ProductWaitlists {
  constructor(
    private readonly dependencies: {
      readonly prisma: SalesFunnelPrismaClient;
      readonly links: Pick<TelegramAccountLinks, "readBinding">;
      readonly clock: () => Date;
    },
  ) {}
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
        await tx.productWaitlistMembership.upsert({
          where: { intakeId_accountId: key },
          create: {
            ...key,
            active: true,
            source: parsed.data.source,
            joinedAt: now,
            updatedAt: now,
          },
          update: {
            active: true,
            source: parsed.data.source,
            joinedAt: now,
            updatedAt: now,
          },
        });
        await tx.productWaitlistEvent.create({
          data: {
            id: randomUUID(),
            ...key,
            kind: "joined",
            source: parsed.data.source,
            occurredAt: now,
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
