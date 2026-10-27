import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { createTestDatabase } from "./setup/test-database.js";
import { migrateBefore, upgradeToLatest } from "./setup/historical-upgrade.js";

test("course rollout resolves only existing unambiguous Products and preserves exact legacy attempts, sources and receipts on replay", async () => {
  const db = await createTestDatabase();
  const pool = new Pool({ connectionString: db.url, max: 1 });
  try {
    await migrateBefore(db, "0107_course_activation_products");
    const product = randomUUID(),
      missing = randomUUID();
    await pool.query(
      "insert into products.series(id,slug,name) values($1::uuid,$1::text,'Course')",
      [product],
    );
    const scenarios = [
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${product}`, "support"],
        expected: product,
        published: true,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${product}`, `product:${missing}`],
        expected: null,
        published: false,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${missing}`],
        expected: null,
        published: false,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: ["materials", "community"],
        expected: null,
        published: false,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${product}`, "support"],
        expected: null,
        published: false,
        offerRevision: 8,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${product}`, "support"],
        expected: null,
        published: false,
        archived: true,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${product}`, "support"],
        expected: null,
        published: false,
        assignable: false,
      },
      {
        id: randomUUID(),
        offer: randomUUID(),
        benefits: [`product:${product}`, "support"],
        expected: null,
        published: false,
        missingSupportTerm: true,
      },
    ];
    for (const row of scenarios) {
      await pool.query(
        "insert into billing.offers(id,revision,name,benefits,archived,available_for_assignment,benefit_periods) values($1,$3,'Historical course',$2,$4,$5,$6)",
        [
          row.offer,
          row.benefits,
          "offerRevision" in row ? row.offerRevision : 7,
          "archived" in row && row.archived,
          !("assignable" in row) || row.assignable,
          JSON.stringify(
            "missingSupportTerm" in row
              ? []
              : [{ capability: "support", months: 3 }],
          ),
        ],
      );
      await pool.query(
        "insert into account_rights.activation_rules(id,code,name,revision,tier_id,tier_revision,source_ref,published,starts_at,reason) values($1::uuid,$1::text,'Historical rule',3,$2,7,$1::text,true,'2030-01-01','Historical source')",
        [row.id, row.offer],
      );
    }
    const rule = scenarios[0];
    if (rule === undefined) throw new Error("Missing fixture");
    const attempt = randomUUID(),
      source = randomUUID(),
      operation = randomUUID();
    const result = {
      contractVersion: "inside.subscription-activation.v1",
      attemptId: attempt,
      state: "active",
      enrollment: null,
    };
    await pool.query(
      "insert into account_rights.activation_attempts(id,identity_ref,rule_id,rule_revision,result,expires_at) values($1,'historical-identity',$2,3,$3,'2030-03-01')",
      [attempt, rule.id, result],
    );
    await pool.query(
      "insert into account_rights.source_entitlements(id,origin,source_ref,source_policy_ref,identity_ref,revision,evidence,checked_at) values($1,'course','historical-source','historical-policy','historical-identity',1,$2,'2030-01-31')",
      [source, { historical: true }],
    );
    await db.prisma.accessReceipt.create({
      data: {
        scope: "source-evidence",
        operationId: operation,
        fingerprint: "a".repeat(64),
        payload: { evidenceRef: operation, immutable: "original" },
        result,
        createdAt: new Date("2030-01-31T00:00:00Z"),
      },
    });
    const beforeAttempt = await pool.query(
      "select to_jsonb(a) as value from account_rights.activation_attempts a where id=$1",
      [attempt],
    );
    const beforeReceipt = await pool.query(
      "select to_jsonb(a) as value from account_rights.access_receipts a where operation_id=$1",
      [operation],
    );
    const beforeSource = await pool.query(
      "select to_jsonb(a) as value from account_rights.source_entitlements a where id=$1",
      [source],
    );
    await upgradeToLatest(db);
    for (const row of scenarios) {
      expect(
        (
          await pool.query(
            "select product_id,published,tier_id,tier_revision,revision from account_rights.activation_rules where id=$1",
            [row.id],
          )
        ).rows,
      ).toEqual([
        {
          product_id: row.expected,
          published: row.published,
          tier_id: row.offer,
          tier_revision: 7,
          revision: 3,
        },
      ]);
    }
    for (const row of scenarios) {
      const inventory = await pool.query(
        "select disposition,source->'rule'->>'tier_revision' as pinned_revision,source->'offer'->>'revision' as offer_revision from account_rights.course_rule_migration_inventory where rule_id=$1",
        [row.id],
      );
      expect(inventory.rows).toEqual([
        {
          disposition:
            row.expected === null
              ? "paused_requires_review"
              : "mapped_exact_pinned_revision",
          pinned_revision: "7",
          offer_revision:
            "offerRevision" in row ? String(row.offerRevision) : "7",
        },
      ]);
    }
    expect(
      (
        await pool.query(
          "select to_jsonb(a) as value from account_rights.activation_attempts a where id=$1",
          [attempt],
        )
      ).rows,
    ).toEqual(beforeAttempt.rows);
    expect(
      (
        await pool.query(
          "select to_jsonb(a) as value from account_rights.access_receipts a where operation_id=$1",
          [operation],
        )
      ).rows,
    ).toEqual(beforeReceipt.rows);
    expect(
      (
        await pool.query(
          "select to_jsonb(a)-'first_issued_at' as value from account_rights.source_entitlements a where id=$1",
          [source],
        )
      ).rows,
    ).toEqual(beforeSource.rows);
    expect(
      (
        await pool.query(
          "select first_issued_at from account_rights.source_entitlements where id=$1",
          [source],
        )
      ).rows,
    ).toEqual([{ first_issued_at: null }]);
  } finally {
    await pool.end();
    await db.dispose();
  }
});
