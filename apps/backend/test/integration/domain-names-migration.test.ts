import {
  contractDigest,
  commandDigest,
} from "../../src/infrastructure/contracts/canonical-digest.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  paidPeriodCommandSchema,
} from "../../src/modules/account-rights/index.js";
import {
  BillingPayments,
  BillingSubscriptions,
} from "../../src/modules/billing/index.js";
import { ProductDirectory } from "../../src/modules/materials/index.js";
import { assembleApplySourceTask } from "../../src/modules/product-tasks/features/import-product-task/import-product-task.js";
import { BankFixture } from "./setup/bank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { seedPurchaseInvitation } from "./setup/purchase-invitation.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { runMigrationsToLatest } from "../../src/infrastructure/postgres/migrate-to-latest.js";
import {
  migrateToLatest,
  platformMigrations,
} from "../../src/migrations/index.js";
import { createTestDatabase } from "./setup/test-database.js";

// The upgrade starts with the production vocabulary, not the already-renamed Prisma mappings.
test("upgrades persisted product rights, tariff snapshots and closed access without losing rows", async () => {
  const database = await createTestDatabase();
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    const index = platformMigrations.findIndex(
      ({ name }) => name === "0082_domain_names",
    );
    await runMigrationsToLatest(
      database.url,
      index < 0 ? platformMigrations : platformMigrations.slice(0, index),
    );
    const productId = randomUUID();
    const grantId = randomUUID();
    const assignmentId = randomUUID();
    const accountId = randomUUID();
    const offerId = randomUUID();
    const materialId = randomUUID();
    const coverage = {
      guideIds: [productId],
      materialIds: [],
      allGuides: true,
    };
    const authoredBody = {
      type: "doc",
      guide: { guideId: "authored-example", contentScope: "lesson text" },
    };
    await pool.query(
      "insert into materials.series(id, slug, name) values ($1, 'migration-course', 'Course')",
      [productId],
    );
    await pool.query(
      `insert into membership_entitlements.access_grants
      (id, account_id, source, source_ref, capabilities, content_scope, starts_at, revision, reason)
      values ($1, $2, 'manual', 'migration-grant', $3, $4, '2030-01-01', 1, 'Existing right')`,
      [grantId, accountId, [`guide:${productId}`, "community"], coverage],
    );
    await pool.query(
      `insert into billing.offers(id, name, benefits, revision, content_scope)
      values ($1, 'Existing tariff', $2, 1, $3)`,
      [offerId, [`guide:${productId}`, "community"], coverage],
    );
    await pool.query(
      `insert into membership_entitlements.subscription_enrollments
      (id, account_id, tier_id, tier_revision, snapshot, origin, source_ref, starts_at, end_policy, revision, reason)
      values ($1, $2, $3, 1, $4, 'manual', 'migration-assignment', '2030-01-01', 'fixed', 1, 'Existing assignment')`,
      [
        assignmentId,
        accountId,
        offerId,
        {
          id: offerId,
          revision: 1,
          name: "Existing tariff",
          benefits: [`guide:${productId}`, "community"],
          contentScope: coverage,
        },
      ],
    );
    await pool.query(
      `insert into materials.materials(id, title, format_id, schema_version, body, created_by, access, publication_state, content_version)
      values ($1, 'Existing closed lesson', 'guide', 1, $3, $2, 'membership', 'draft', 1)`,
      [materialId, accountId, authoredBody],
    );
    await migrateToLatest(database.url);
    expect(
      await database.prisma.accessGrant.findUnique({ where: { id: grantId } }),
    ).toMatchObject({
      id: grantId,
      accountId,
      capabilities: [`product:${productId}`, "community"],
      coverage: {
        productIds: [productId],
        materialIds: [],
        wholePlatform: true,
      },
      revision: 1,
      revokedAt: null,
    });
    expect(
      await database.prisma.tariffAssignment.findUnique({
        where: { id: assignmentId },
      }),
    ).toMatchObject({
      id: assignmentId,
      accountId,
      tierId: offerId,
      snapshot: {
        benefits: [`product:${productId}`, "community"],
        coverage: {
          productIds: [productId],
          materialIds: [],
          wholePlatform: true,
        },
      },
    });
    expect(
      await database.prisma.material.findUnique({ where: { id: materialId } }),
    ).toMatchObject({
      access: "closed",
      formatId: "guide",
      body: authoredBody,
    });
    expect(
      await database.prisma.product.findUnique({ where: { id: productId } }),
    ).toMatchObject({ name: "Course", slug: "migration-course" });
    expect(
      (
        await pool.query(
          "select to_regnamespace('membership_entitlements') as old_schema, to_regclass('account_rights.subscription_enrollments') as old_table",
        )
      ).rows,
    ).toEqual([{ old_schema: null, old_table: null }]);
    // The upgraded late-fulfillment trigger still fills coverage from the frozen baseline.
    const lateId = randomUUID();
    await database.prisma.accessGrant.create({
      data: {
        id: lateId,
        accountId,
        source: "manual",
        sourceRef: "late-migration-grant",
        capabilities: ["materials"],
        startsAt: new Date("2030-01-01Z"),
        revision: 1,
        reason: "Late fulfillment",
      },
    });
    expect(
      (await database.prisma.accessGrant.findUnique({ where: { id: lateId } }))
        ?.coverage,
    ).toMatchObject({
      productIds: [],
      materialIds: [],
    });
    expect(await migrateToLatest(database.url)).toEqual({
      appliedMigrations: [],
    });
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test("recovers a pre-upgrade paid receipt committed before fulfillment appliedAt", async () => {
  const database = await createTestDatabase();
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    const index = platformMigrations.findIndex(
      ({ name }) => name === "0082_domain_names",
    );
    await runMigrationsToLatest(
      database.url,
      platformMigrations.slice(0, index),
    );
    const accountId = randomUUID(),
      productId = randomUUID(),
      grantId = randomUUID();
    const purchaseRef = randomUUID(),
      eventRef = randomUUID(),
      quoteRef = randomUUID();
    const now = new Date("2030-02-01T00:00:00Z");
    const periodRef = `${purchaseRef}:guide:${productId}`;
    // This is the command and envelope emitted by the production runtime before 0082.
    const command = {
      eventRef,
      periodRef,
      accountId,
      revision: 1,
      revoked: false,
      terms: {
        capabilities: ["materials"],
        contentScope: { guideIds: [productId], materialIds: [] },
        startsAt: "2030-01-01T00:00:00.000Z",
        validUntil: "2030-03-01T00:00:00.000Z",
        reason: "guide: is part of the original reason",
      },
    };
    const fingerprint = commandDigest({ version: 2, value: command });
    const result = { ok: true, grantRef: grantId, revision: 1 };
    await pool.query(
      "insert into accounts.accounts(id, logto_issuer, logto_subject) values ($1, 'https://identity.example.test', $2)",
      [accountId, accountId],
    );
    await pool.query(
      "insert into materials.series(id, slug, name) values ($1, 'crash-course', 'guide: is part of the original name')",
      [productId],
    );
    await pool.query(
      `insert into billing.price_quotes(id,account_id,operation_id,fingerprint,snapshot,created_at,expires_at)
      values ($1,$2,$3,'previous-price-fingerprint','{}','2030-01-01','2030-01-02')`,
      [quoteRef, accountId, randomUUID()],
    );
    await pool.query(
      `insert into billing.purchases
      (id,account_id,quote_ref,state,environment,terminal_ref,amount_kopecks,snapshot,acceptance,contact,fiscalization,confirmed_at,period_ends_at,created_at,updated_at)
      values ($1,$2,$3,'confirmed','demo','SYNTHETIC',100,'{}','{}','{}','not_configured','2030-01-01','2030-03-01','2030-01-01','2030-01-01')`,
      [purchaseRef, accountId, quoteRef],
    );
    await pool.query(
      `insert into membership_entitlements.access_grants
      (id,account_id,source,source_ref,capabilities,content_scope,starts_at,valid_until,revision,reason)
      values ($1,$2,'paid',$3,ARRAY['materials'],$4,'2030-01-01','2030-03-01',1,$5)`,
      [
        grantId,
        accountId,
        periodRef,
        command.terms.contentScope,
        command.terms.reason,
      ],
    );
    await pool.query(
      `insert into membership_entitlements.access_receipts(scope,operation_id,fingerprint,payload,result,created_at)
      values ('paid-period',$1,$2,$3,$4,'2030-01-01')`,
      [eventRef, fingerprint, command, result],
    );
    await pool.query(
      `insert into billing.fulfillment_outbox(event_ref,purchase_ref,payload,next_attempt_at)
      values ($1,$2,$3,'2030-01-01')`,
      [eventRef, purchaseRef, command],
    );
    await migrateToLatest(database.url);
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "synthetic-migration-fingerprint-00000",
    });
    const grants = assembleAccessGrants({
      prisma: database.prisma,
      accounts,
      clock: () => now,
    });
    const payments = new BillingPayments({
      prisma: database.prisma,
      grants,
      bank: undefined,
      clock: () => now,
      contact: {
        read: () =>
          Promise.reject(new Error("recover must not request contact")),
        readConsent: () =>
          Promise.reject(new Error("recover must not request consent")),
      },
    });
    expect(await payments.recover()).toEqual({
      ok: true,
      value: { status: "configuration_idle", inspected: 0, applied: 1 },
    });
    expect(await payments.recover()).toEqual({
      ok: true,
      value: { status: "configuration_idle", inspected: 0, applied: 0 },
    });
    const migrated = await database.prisma.billingFulfillment.findUniqueOrThrow(
      { where: { eventRef } },
    );
    expect(migrated.appliedAt).toEqual(now);
    expect(
      await grants.applyPaidPeriod(
        paidPeriodCommandSchema.parse(migrated.payload),
      ),
    ).toEqual(result);
    expect(
      await database.prisma.accessReceipt.findUniqueOrThrow({
        where: {
          scope_operationId: { scope: "paid-period", operationId: eventRef },
        },
      }),
    ).toMatchObject({ fingerprint });
    expect(
      await database.prisma.accessGrant.findMany({ where: { accountId } }),
    ).toMatchObject([
      {
        id: grantId,
        sourceRef: `${purchaseRef}:product:${productId}`,
        reason: command.terms.reason,
      },
    ]);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test("replays and accepts an unexpired change quote saved before the rename", async () => {
  const database = await createTestDatabase();
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    const index = platformMigrations.findIndex(
      ({ name }) => name === "0082_domain_names",
    );
    await runMigrationsToLatest(
      database.url,
      platformMigrations.slice(0, index),
    );
    const accountId = randomUUID(),
      productId = randomUUID(),
      offerId = randomUUID();
    const optionId = randomUUID(),
      currentOptionId = randomUUID(),
      subscriptionRef = randomUUID();
    const changeQuoteRef = randomUUID(),
      operationId = randomUUID();
    const now = new Date("2030-02-01T00:00:00.000Z");
    const coverage = { guideIds: [productId], materialIds: [] };
    const offer = {
      id: offerId,
      revision: 1,
      name: "guide: original tariff name",
      benefits: [`guide:${productId}`],
      archived: false,
      published: true,
      contentScope: coverage,
      eligibility: "everyone",
    };
    const option = {
      id: optionId,
      revision: 1,
      offerId,
      mode: "subscription",
      months: 1,
      priceKopecks: 10000,
      archived: false,
    };
    const currentOption = {
      ...option,
      id: currentOptionId,
      priceKopecks: 20000,
    };
    const snapshot = {
      offer,
      paymentOption: option,
      promotion: null,
      currency: "RUB",
      timezone: "Europe/Moscow",
      firstPriceKopecks: 10000,
      renewalPriceKopecks: 10000,
    };
    const currentSnapshot = {
      offer,
      paymentOption: currentOption,
      currency: "RUB",
      timezone: "Europe/Moscow",
      renewalPriceKopecks: 20000,
    };
    const plan = {
      kind: "scheduled",
      snapshot,
      nextPriceKopecks: 10000,
      effectiveAt: "2030-03-01T00:00:00.000Z",
    };
    const command = {
      operationId,
      expectedRevision: 1,
      paymentOptionId: optionId,
    };
    const fingerprint = commandDigest({
      version: 1,
      operation: "quoteChange",
      command,
    });
    await database.prisma.account.create({
      data: {
        id: accountId,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: accountId,
      },
    });
    await pool.query(
      "insert into billing.offers(id,name,benefits,revision,published,content_scope) values ($1,$2,$3,1,true,$4)",
      [offerId, offer.name, offer.benefits, coverage],
    );
    await database.prisma.billingPaymentOption.createMany({
      data: [option, currentOption],
    });
    await database.prisma.billingSubscription.create({
      data: {
        id: subscriptionRef,
        accountId,
        state: "active",
        snapshot: currentSnapshot,
        consent: {
          evidenceRefs: [randomUUID()],
          documents: [
            {
              kind: "recurring",
              documentId: "synthetic",
              version: "1",
              digest: "a".repeat(64),
            },
          ],
          acceptedAt: "2030-01-01T00:00:00.000Z",
        },
        anchorAt: new Date("2030-01-01Z"),
        anchorMonths: 1,
        periodIndex: 1,
        periodStartsAt: new Date("2030-01-01Z"),
        paidUntil: new Date(plan.effectiveAt),
        periodAmountKopecks: 20000,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await database.prisma.billingChangeQuote.create({
      data: {
        id: changeQuoteRef,
        subscriptionRef,
        accountId,
        operationId,
        fingerprint,
        baseRevision: 1,
        plan,
        createdAt: now,
        expiresAt: new Date("2030-02-01T00:15:00Z"),
      },
    });
    await migrateToLatest(database.url);
    await seedPurchaseInvitation(database.prisma, accountId, offerId);
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "synthetic-migration-fingerprint-00000",
    });
    const grants = assembleAccessGrants({
      prisma: database.prisma,
      accounts,
      clock: () => now,
    });
    const bank = new BankFixture(
      syntheticTbankConfig({
        environment: "demo",
        terminalKey: "SYNTHETICMIGRATION",
        password: "synthetic-test-password",
        bindingEncryptionKey: Buffer.alloc(32, 51).toString("base64"),
        recurringCardConfirmed: true,
        cardOnlyHostedConfirmed: true,
        cardBinding: { confirmed: true, checkType: "3DS" },
        minimumKopecks: 100,
        maximumKopecks: 10000000,
        returnUrl: "https://inside.example.test/subscription/return",
        notificationUrl:
          "https://inside.example.test/billing/tbank/notification",
        receipt: { taxation: "usn_income", tax: "none" },
      }),
    );
    const subscriptions = new BillingSubscriptions({
      prisma: database.prisma,
      grants,
      bank: bank.client(),
      clock: () => now,
      contact: {
        read: () => Promise.resolve({ ok: true, contact: null, documents: [] }),
        readConsent: () =>
          Promise.reject(
            new Error("scheduled change must not request new consent"),
          ),
      },
      payments: {
        dispatch: () =>
          Promise.reject(new Error("scheduled change must not dispatch")),
        status: () =>
          Promise.reject(new Error("scheduled change must not charge")),
        history: () => Promise.resolve({ ok: true, value: [] }),
      },
      notices: { readNotices: () => Promise.resolve([]) },
    });
    expect(await subscriptions.quoteChange(accountId, command)).toMatchObject({
      ok: true,
      value: {
        changeQuoteRef,
        plan: {
          snapshot: {
            offer: {
              name: offer.name,
              benefits: [`product:${productId}`],
              coverage: { productIds: [productId], materialIds: [] },
            },
          },
        },
      },
    });
    const change = {
      operationId: randomUUID(),
      expectedRevision: 1,
      changeQuoteRef,
    };
    const accepted = await subscriptions.change(accountId, change);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        payment: null,
        subscription: {
          revision: 2,
          pendingChange: {
            changeQuoteRef,
            snapshot: { offer: { benefits: [`product:${productId}`] } },
          },
        },
      },
    });
    expect(await subscriptions.change(accountId, change)).toEqual(accepted);
    expect(bank.initCalls).toBe(0);
    expect(bank.chargeCalls).toBe(0);
  } finally {
    await pool.end();
    await database.dispose();
  }
});

test("replays an imported pre-upgrade task under its renamed operation and fields", async () => {
  const database = await createTestDatabase();
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    const index = platformMigrations.findIndex(
      ({ name }) => name === "0082_domain_names",
    );
    await runMigrationsToLatest(
      database.url,
      platformMigrations.slice(0, index),
    );
    const actor = randomUUID(),
      productId = randomUUID(),
      chapterId = randomUUID(),
      taskId = randomUUID();
    const idempotencyKey = "authoring:previous-command-key";
    const definition = {
      schemaVersion: 1,
      situation: "Build the learner request.",
      result: ["The request has a status."],
      freedom: "Choose the stack.",
      criteria: [
        {
          id: "request",
          level: "required",
          requirement: "Create a request.",
          acceptableEvidence: ["Show the request."],
        },
      ],
    };
    const command = {
      sourceId: "inside-content:upgrade-task",
      code: "upgrade-task",
      guideId: productId,
      chapterId,
      position: 1,
      title: "Existing task",
      access: "membership",
      definition,
      relatedMaterialSourceIds: [],
      afterMaterialSourceId: null,
      publicationState: "published",
      provenance: {
        repository: "sachkov-inside/inside-content",
        commit: "c".repeat(40),
        path: "course/tasks/upgrade-task.yaml",
      },
      expectedRevision: null,
    };
    const fingerprint = commandDigest({
      operation: "apply_guide_task",
      ...command,
    });
    const receipt = {
      taskId,
      code: command.code,
      revision: 1,
      currentVersion: 1,
      definitionDigest: contractDigest(definition),
      publicationState: "published",
    };
    await pool.query(
      "insert into materials.series(id,slug,name) values ($1,'task-upgrade','Course')",
      [productId],
    );
    await pool.query(
      "insert into materials.guide_chapters(id,guide_id,name,ordinal) values ($1,$2,'First',1)",
      [chapterId, productId],
    );
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        `insert into guide_tasks.tasks(id,code,source_id,guide_id,chapter_id,position,title,access,related_material_source_ids,publication_state,current_version,revision,created_at,updated_at)
        values ($1,$2,$3,$4,$5,1,$6,'membership','{}','published',1,1,'2030-01-01','2030-01-01')`,
        [
          taskId,
          command.code,
          command.sourceId,
          productId,
          chapterId,
          command.title,
        ],
      );
      await connection.query(
        `insert into guide_tasks.task_versions(task_id,version,definition,definition_digest,created_at,source_repository,source_commit,source_path)
        values ($1,1,$2,$3,'2030-01-01',$4,$5,$6)`,
        [
          taskId,
          definition,
          receipt.definitionDigest,
          command.provenance.repository,
          command.provenance.commit,
          command.provenance.path,
        ],
      );
      await connection.query(
        "insert into guide_tasks.import_receipts(actor_id,operation,idempotency_key,request_fingerprint,receipt) values ($1,'apply_guide_task',$2,$3,$4)",
        [actor, idempotencyKey, fingerprint, receipt],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    await migrateToLatest(database.url);
    const { guideId, ...unchanged } = command;
    const current = { ...unchanged, productId: guideId, access: "closed" };
    const apply = assembleApplySourceTask({
      prisma: database.prisma,
      directory: new ProductDirectory(database.prisma),
      authorPolicy: { canManage: () => true },
    });
    expect(await apply(current, { actor, idempotencyKey })).toEqual({
      ok: true,
      value: receipt,
    });
    expect(
      await apply(
        { ...current, title: "Changed task" },
        { actor, idempotencyKey },
      ),
    ).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
    expect(
      await database.prisma.productTask.findUniqueOrThrow({
        where: { id: taskId },
      }),
    ).toMatchObject({
      id: taskId,
      productId,
      access: "closed",
      revision: 1,
      currentVersion: 1,
    });
    expect(
      await database.prisma.productTaskVersion.count({ where: { taskId } }),
    ).toBe(1);
    expect(
      await database.prisma.productTaskImportReceipt.findUniqueOrThrow({
        where: {
          actorId_operation_idempotencyKey: {
            actorId: actor,
            operation: "apply_product_task",
            idempotencyKey,
          },
        },
      }),
    ).toMatchObject({ requestFingerprint: fingerprint });
  } finally {
    await pool.end();
    await database.dispose();
  }
});
