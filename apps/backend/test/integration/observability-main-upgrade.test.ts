import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  platformMigrations,
  migrateToLatest,
} from "../../src/migrations/index.js";
import {
  migrationChecksum,
  parseAppliedMigrations,
  runMigrationsToLatest,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";
import { createTestDatabase } from "./setup/test-database.js";

import { z } from "zod";
import { frozenRegistry } from "../support/observability-migration-fixtures.js";

it.each(["main101", "main102", "main103"] as const)(
  "upgrades exact frozen %s to canonical116 without changing its prefix",
  async (label) => {
    const mainRegistry = frozenRegistry(label);
    expect(platformMigrations.slice(0, mainRegistry.length)).toEqual(
      mainRegistry,
    );
    expect(platformMigrations).toHaveLength(116);
    expect(new Set(platformMigrations.map(({ name }) => name)).size).toBe(116);
    expect(platformMigrations.slice(103)).toEqual(
      frozenRegistry("legacy115").slice(102),
    );
    const database = await createTestDatabase();
    const ledger = async () =>
      parseAppliedMigrations(
        await database.prisma.$queryRaw(
          Prisma.sql`select name, checksum, position from public.platform_migrations order by position`,
        ),
      );
    try {
      await runMigrationsToLatest(database.url, mainRegistry);
      const before = await ledger();
      expect(before).toEqual(
        mainRegistry.map((migration, index) => ({
          name: migration.name,
          checksum: migrationChecksum(migration.statement),
          position: index + 1,
        })),
      );
      expect(await migrateToLatest(database.url)).toEqual({
        appliedMigrations: platformMigrations
          .slice(mainRegistry.length)
          .map(({ name }) => name),
      });
      const after = await ledger();
      expect(after.slice(0, mainRegistry.length)).toEqual(before);
      expect(after).toEqual(
        platformMigrations.map((migration, index) => ({
          name: migration.name,
          checksum: migrationChecksum(migration.statement),
          position: index + 1,
        })),
      );
      expect(await migrateToLatest(database.url)).toEqual({
        appliedMigrations: [],
      });
      await expect(
        runMigrationsToLatest(database.url, mainRegistry),
      ).rejects.toThrow("not an exact registry prefix");
      expect(
        await runMigrationsToLatest(database.url, [...platformMigrations]),
      ).toEqual({ appliedMigrations: [] });
      const changedSql = platformMigrations.map((migration) =>
        migration.name === "0101_funnel_diagnostic_candidates"
          ? { ...migration, statement: migration.statement + "\n-- changed" }
          : migration,
      );
      await expect(
        runMigrationsToLatest(database.url, changedSql),
      ).rejects.toThrow(
        "Migration checksum mismatch: 0101_funnel_diagnostic_candidates",
      );
      expect(await ledger()).toEqual(after);
    } finally {
      await database.dispose();
    }
  },
);

it.each(["root109", "legacy113", "legacy114", "legacy115"] as const)(
  "rejects frozen %s without changing ledger or historical tracking rows",
  async (label) => {
    const historical = frozenRegistry(label);
    const database = await createTestDatabase();
    const ledger = async () =>
      parseAppliedMigrations(
        await database.prisma.$queryRaw(
          Prisma.sql`select name, checksum, position from public.platform_migrations order by position`,
        ),
      );
    const domain = async () =>
      z
        .array(z.strictObject({ snapshot: z.string() }))
        .parse(
          await database.prisma.$queryRaw(
            Prisma.sql`select row_to_json(t)::text as snapshot from communications.tracking_hits t order by event_id`,
          ),
        );
    try {
      await runMigrationsToLatest(database.url, historical);
      await database.prisma.$executeRaw(Prisma.sql`
      insert into communications.tracking_hits (event_id, token, occurred_at, traffic, available_at)
      values ('9f30cb17-16d4-4683-92f7-425003956a10'::uuid, 'historical-tracking-token-0000000000000000',
      '2026-10-07T09:00:00Z'::timestamptz, 'unknown', '2026-10-07T09:00:00Z'::timestamptz)
    `);
      const before = await ledger();
      const rows = await domain();
      expect(rows).toHaveLength(1);
      await expect(migrateToLatest(database.url)).rejects.toThrow(
        `not an exact registry prefix at position ${label === "root109" ? "102" : "103"}`,
      );
      expect(await ledger()).toEqual(before);
      expect(await domain()).toEqual(rows);
      expect(await runMigrationsToLatest(database.url, historical)).toEqual({
        appliedMigrations: [],
      });
      expect(await ledger()).toEqual(before);
      expect(await domain()).toEqual(rows);
    } finally {
      await database.dispose();
    }
  },
);

// Frozen from prepared root4da87e1d before adding the two carrier migrations.
const preparedRootCount = 109;
const preparedRootDigest =
  "9ec856bf4e1f555c648028ed80fd2d8715835376746b8eb3b42166b23a5b3872";
const carrierChecksums = [
  "ee7ee354bfe652213c914e47368f9e115ac14bbca2a994aa418a581dfeafac2b",
  "d8f7fbb29735fd290bcf6fbcd0f2c8b79a6e469749f590e9a2764867f08da28c",
  "fb4ac34965f919b5086aa562637f11bafc8ec366950091e17e195f004d0fb679",
];
it("retains the frozen historical root0108 upgrade and rejects its divergent ledger against current main", async () => {
  const rootRegistry = frozenRegistry("root109");
  const preparedRegistry = [
    ...rootRegistry,
    ...frozenRegistry("legacy113").filter(({ name }) =>
      [
        "0109_materials_notification_trace_context",
        "0110_notifications_notification_trace_context",
        "0111_notifications_email_trace_context",
      ].includes(name),
    ),
  ];
  expect(
    createHash("sha256").update(JSON.stringify(rootRegistry)).digest("hex"),
  ).toBe(preparedRootDigest);
  expect(rootRegistry.at(-1)?.name).toBe("0108_submission_activity_period");
  expect(
    preparedRegistry
      .slice(preparedRootCount)
      .map(({ statement }) => migrationChecksum(statement)),
  ).toEqual(carrierChecksums);
  const database = await createTestDatabase();
  const ledger = async () =>
    parseAppliedMigrations(
      await database.prisma.$queryRaw(Prisma.sql`
    select name, checksum, position from public.platform_migrations order by position
  `),
    );
  try {
    await runMigrationsToLatest(database.url, rootRegistry);
    const before = await ledger();
    await expect(migrateToLatest(database.url)).rejects.toThrow(
      "not an exact registry prefix at position 102",
    );
    expect(await ledger()).toEqual(before);
    expect(await runMigrationsToLatest(database.url, preparedRegistry)).toEqual(
      {
        appliedMigrations: [
          "0109_materials_notification_trace_context",
          "0110_notifications_notification_trace_context",
          "0111_notifications_email_trace_context",
        ],
      },
    );
    const after = await ledger();
    expect(after.slice(0, preparedRootCount)).toEqual(before);
    expect(after.slice(preparedRootCount)).toEqual([
      {
        name: "0109_materials_notification_trace_context",
        checksum: carrierChecksums[0],
        position: 110,
      },
      {
        name: "0110_notifications_notification_trace_context",
        checksum: carrierChecksums[1],
        position: 111,
      },
      {
        name: "0111_notifications_email_trace_context",
        checksum: carrierChecksums[2],
        position: 112,
      },
    ]);
    expect(await runMigrationsToLatest(database.url, preparedRegistry)).toEqual(
      {
        appliedMigrations: [],
      },
    );
    await expect(
      runMigrationsToLatest(database.url, rootRegistry),
    ).rejects.toThrow("not an exact registry prefix at position 110");
    const oldAllocation = [
      ...rootRegistry,
      ...preparedRegistry.slice(preparedRootCount).map((migration, index) => ({
        ...migration,
        name:
          index === 0
            ? "0108_materials_notification_trace_context"
            : index === 1
              ? "0109_notifications_notification_trace_context"
              : migration.name,
      })),
      ...frozenRegistry("main102").slice(101),
    ];
    expect(oldAllocation).toHaveLength(113);
    expect(oldAllocation.map(({ name }) => name).slice(-4)).toEqual([
      "0108_materials_notification_trace_context",
      "0109_notifications_notification_trace_context",
      "0111_notifications_email_trace_context",
      "0101_waitlist_confirmations",
    ]);
    expect(new Set(oldAllocation.map(({ name }) => name)).size).toBe(
      oldAllocation.length,
    );
    await expect(
      runMigrationsToLatest(database.url, oldAllocation),
    ).rejects.toThrow("not an exact registry prefix at position 110");
    const changedCarrier = preparedRegistry.map((migration, index) =>
      index === preparedRootCount
        ? { ...migration, statement: migration.statement + "\n-- changed" }
        : migration,
    );
    await expect(
      runMigrationsToLatest(database.url, changedCarrier),
    ).rejects.toThrow(
      "Migration checksum mismatch: 0109_materials_notification_trace_context",
    );
    expect(
      await runMigrationsToLatest(database.url, [...preparedRegistry]),
    ).toEqual({ appliedMigrations: [] });
    await expect(migrateToLatest(database.url)).rejects.toThrow(
      "not an exact registry prefix at position 102",
    );
    expect(await ledger()).toEqual(after);
  } finally {
    await database.dispose();
  }
});

// Frozen from the exact prepared registry at root88301c77, before the nullable tracking carrier.
it.each(["historical113", "canonical114"] as const)(
  "preserves old tracking writers from %s using its matching registry",
  async (label) => {
    const prefix =
      label === "historical113"
        ? frozenRegistry("legacy113")
        : platformMigrations.slice(0, 114);
    const target =
      label === "historical113"
        ? frozenRegistry("legacy115")
        : platformMigrations;
    const database = await createTestDatabase();
    try {
      await runMigrationsToLatest(database.url, prefix);
      await database.prisma.$executeRaw(Prisma.sql`
      insert into communications.tracking_hits (event_id, token, occurred_at, traffic, available_at)
      values ('9f30cb17-16d4-4683-92f7-425003956a10'::uuid, 'historical-tracking-token-0000000000000000',
        '2026-10-07T09:00:00Z'::timestamptz, 'unknown', '2026-10-07T09:00:00Z'::timestamptz)
    `);
      const before = parseAppliedMigrations(
        await database.prisma.$queryRaw(Prisma.sql`
      select name, checksum, position from public.platform_migrations order by position
    `),
      );
      expect(await runMigrationsToLatest(database.url, target)).toEqual({
        appliedMigrations: [
          "0112_communications_tracking_trace_context",
          "0113_waitlist_trace_context",
        ],
      });
      const after = parseAppliedMigrations(
        await database.prisma.$queryRaw(Prisma.sql`
      select name, checksum, position from public.platform_migrations order by position
    `),
      );
      expect(after.slice(0, prefix.length)).toEqual(before);
      expect(after).toHaveLength(target.length);
      const hit =
        await database.prisma.communicationTrackingHit.findUniqueOrThrow({
          where: { eventId: "9f30cb17-16d4-4683-92f7-425003956a10" },
        });
      expect(hit.traceparent).toBeNull();
      expect(hit.token).toBe("historical-tracking-token-0000000000000000");
      expect(hit.availableAt.toISOString()).toBe("2026-10-07T09:00:00.000Z");
      expect(hit.claimId).toBeNull();
      expect(hit.deliveredAt).toBeNull();
      // An old writer names only its original columns; the new nullable carrier does not require a value.
      expect(
        await database.prisma.$executeRaw(Prisma.sql`
      update communications.tracking_hits set claim_id = null
      where event_id = '9f30cb17-16d4-4683-92f7-425003956a10'::uuid
    `),
      ).toBe(1);
      expect(await runMigrationsToLatest(database.url, target)).toEqual({
        appliedMigrations: [],
      });
      await expect(runMigrationsToLatest(database.url, prefix)).rejects.toThrow(
        `not an exact registry prefix at position ${String(prefix.length + 1)}`,
      );
    } finally {
      await database.dispose();
    }
  },
);

it.each(["historical114", "canonical115"] as const)(
  "preserves old waitlist receipt writers from %s using its matching registry",
  async (label) => {
    const prefix =
      label === "historical114"
        ? frozenRegistry("legacy114")
        : platformMigrations.slice(0, 115);
    const target =
      label === "historical114"
        ? frozenRegistry("legacy115")
        : platformMigrations;
    const database = await createTestDatabase();
    try {
      await runMigrationsToLatest(database.url, prefix);
      await database.prisma.$executeRaw(Prisma.sql`
      insert into sales_funnel.product_waitlist_intakes(id, product_id, name, accepting)
      values ('11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'Historical', true)
    `);
      await database.prisma.$executeRaw(Prisma.sql`
      insert into sales_funnel.product_waitlist_events(id, intake_id, account_id, kind, occurred_at)
      values ('33333333-3333-4333-8333-333333333333'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'joined', '2026-10-07T09:00:00Z'::timestamptz)
    `);
      await database.prisma.$executeRaw(Prisma.sql`
      insert into sales_funnel.product_waitlist_confirmations(event_id, intake_id, account_id, account_ref, telegram_identity_ref, link_revision, created_at)
      values ('33333333-3333-4333-8333-333333333333'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'historical-account', 'historical-identity', 1, '2026-10-07T09:00:00Z'::timestamptz)
    `);
      const ledger = async () =>
        parseAppliedMigrations(
          await database.prisma.$queryRaw(
            Prisma.sql`select name, checksum, position from public.platform_migrations order by position`,
          ),
        );
      const before = await ledger();
      expect(await runMigrationsToLatest(database.url, target)).toEqual({
        appliedMigrations: ["0113_waitlist_trace_context"],
      });
      const after = await ledger();
      expect(after.slice(0, prefix.length)).toEqual(before);
      expect(after).toHaveLength(target.length);
      const row =
        await database.prisma.productWaitlistConfirmation.findUniqueOrThrow({
          where: { eventId: "33333333-3333-4333-8333-333333333333" },
        });
      expect(row.traceparent).toBeNull();
      expect(row.completedAt).toBeNull();
      expect(row.accountRef).toBe("historical-account");
      expect(row.createdAt.toISOString()).toBe("2026-10-07T09:00:00.000Z");
      // The old relay's named-column update remains valid. No historical parent is invented.
      expect(
        await database.prisma.$executeRaw(
          Prisma.sql`update sales_funnel.product_waitlist_confirmations set completed_at = '2026-10-07T09:00:01Z'::timestamptz where event_id = '33333333-3333-4333-8333-333333333333'::uuid and completed_at is null`,
        ),
      ).toBe(1);
      expect(
        (
          await database.prisma.productWaitlistConfirmation.findUniqueOrThrow({
            where: { eventId: row.eventId },
          })
        ).traceparent,
      ).toBeNull();
      expect(await runMigrationsToLatest(database.url, target)).toEqual({
        appliedMigrations: [],
      });
      await expect(runMigrationsToLatest(database.url, prefix)).rejects.toThrow(
        `not an exact registry prefix at position ${String(prefix.length + 1)}`,
      );
    } finally {
      await database.dispose();
    }
  },
);
