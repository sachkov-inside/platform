import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createRestorePostgres,
  snapshotDatabase,
  type RestorePostgres,
  type RestoreDatabase,
} from "../../../../scripts/fixtures/domain-restore/postgres.mjs";
import {
  runMigrationsToLatest,
  migrationRegistryIdentity,
} from "../../src/infrastructure/postgres/migrate-to-latest.js";
import {
  platformMigrations,
  migrateToLatest,
} from "../../src/migrations/index.js";
import {
  Prisma,
  createPrismaClient,
} from "../../src/infrastructure/prisma/index.js";
import {
  assembleAccounts,
  BillingContact,
  accountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import {
  assembleAccountProfiles,
  AccountNames,
  moderateAccountProfile,
} from "../../src/modules/account-profiles/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import {
  ProductDirectory,
  ProductDiscovery,
} from "../../src/modules/products/index.js";
import { BillingPayments } from "../../src/modules/billing/index.js";
import {
  Tbank,
  tbankToken,
} from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { practiceDefinitionDigest } from "../../src/modules/materials/domain/practice-definition.js";
import { taskDefinitionDigest } from "../../src/modules/product-tasks/domain/task-definition.js";
import { guardTransactionConnections } from "./setup/transaction-guard.js";
import { commandDigest } from "../../src/infrastructure/contracts/canonical-digest.js";
import { fingerprintCommand } from "../../src/modules/materials/shared/canonical-command-fingerprint.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  materialBodyOperations,
  assembleProductMaterialReading,
  assembleMaterialResourceFacts,
} from "../../src/modules/materials/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { assembleLearningTasks } from "../../src/modules/product-tasks/index.js";
import { assembleProductTaskResourceFacts } from "../../src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";

let postgres: RestorePostgres;
let cleanup = () => Promise.resolve();
beforeAll(async () => {
  postgres = await createRestorePostgres("backend");
  cleanup = () => postgres.close();
});
afterAll(async () => {
  await cleanup();
});

const instant = new Date("2030-01-31T10:00:00Z");
const ids = Object.fromEntries(
  [
    "activeProfile",
    "disabledProfile",
    "activeAvatar",
    "disabledAvatar",
    "orphanAvatar",
    "owner",
    "holder",
    "revoked",
    "orphan",
    "sentBuyer",
    "unknownBuyer",
    "paidBuyer",
    "recurringBuyer",
    "paid",
    "recurring",
    "paidEvent",
    "product",
    "material",
    "historicalSource",
    "chapter",
    "placement1",
    "placement2",
    "task",
    "sent",
    "unknown",
    "confirmed",
    "event",
    "receipt",
    "acceptance",
    "video",
  ].map((name) => [name, randomUUID()]),
);
function id(name: string): string {
  const value = ids[name];
  if (value === undefined) throw new Error(`Missing fixture ID ${name}`);
  return value;
}
const acceptedText =
  "Synthetic original accepted commercial terms, edition 2020";
const acceptedHash = createHash("sha256").update(acceptedText).digest("hex");
const snapshot = {
  offer: {
    id: randomUUID(),
    revision: 7,
    name: "Historical whole Product",
    benefits: [`product:${id("product")}`],
    archived: false,
  },
  paymentOption: {
    id: randomUUID(),
    offerId: "",
    revision: 3,
    mode: "one_time",
    months: 3,
    priceKopecks: 234567,
    archived: false,
  },
  promotion: null,
  currency: "RUB",
  timezone: "Europe/Moscow",
  firstPriceKopecks: 234567,
  renewalPriceKopecks: 234567,
};
snapshot.paymentOption.offerId = snapshot.offer.id;
const acceptance = {
  documentId: "original-purchase",
  version: "2020",
  text: acceptedText,
  digest: acceptedHash,
};
function createExternalEffects() {
  return {
    init: 0,
    charges: 0,
    telegram: 0,
    storage: 0,
    states: [] as string[],
  };
}

const originalPracticeDefinition = {
  schemaVersion: 1 as const,
  title: "Legacy requirements",
  businessInputs: "Accepted situation",
  expectedOutcome: "Accepted outcome",
  allowedFreedom: "Accepted freedom",
  criteria: [
    {
      id: "evidence",
      requirement: "Accepted requirement",
      acceptableEvidence: ["Saved evidence"],
    },
  ],
};
const originalPracticeCommand = {
  actor: id("owner"),
  idempotencyKey: "original-practice",
  practiceId: "fixture:requirements",
  definition: originalPracticeDefinition,
  sourceReference: {
    materialSourceId: "fixture:lesson",
    materialSourceRevision: "a".repeat(64),
  },
  provenance: {
    repository: "fixture/legacy",
    commit: "f".repeat(40),
    path: "legacy.json",
  },
  publicationState: "unpublished" as const,
  materialId: id("material"),
  expectedContentVersion: 7,
  expectedPracticeVersion: 18,
};
const originalPracticeReceipt = {
  practiceId: "fixture:requirements",
  practiceVersion: 19,
  definitionDigest: practiceDefinitionDigest(
    originalPracticeDefinition,
    originalPracticeCommand.sourceReference,
  ),
  materialId: id("material"),
  boundContentVersion: 7,
  publicationState: "unpublished" as const,
};
const originalSourceRequest = {
  source: {
    id: "fixture:original-source",
    path: "original.md",
    revision: "c".repeat(64),
    showInFeed: false,
  },
  metadata: {
    title: "Original Source",
    summary: null,
    access: "free" as const,
    difficulty: null,
    outcomes: [],
    topicId: null,
    formatId: "note" as const,
    tagIds: [],
    seriesIds: [],
  },
  body: representativeDocument(
    "Original series and showInFeed remain literal authored text",
  ),
  materialId: id("historicalSource"),
  expectedContentVersion: 7,
  publicationState: "draft" as const,
  primaryVideoId: null,
};
const originalSourceCommand = {
  ...originalSourceRequest,
  actor: id("owner"),
  idempotencyKey: "original-source",
};

async function seedLegacy(url: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    for (const who of [
      "owner",
      "holder",
      "revoked",
      "orphan",
      "sentBuyer",
      "unknownBuyer",
      "paidBuyer",
      "recurringBuyer",
    ])
      await pool.query(
        "insert into accounts.accounts(id,logto_issuer,logto_subject) values($1::uuid,'https://synthetic.identity.test',$1::text)",
        [id(who)],
      );
    // Historical physical names and original private storage keys, before the 0112 schema rename.
    for (const [who, profile, status, version, name, bio] of [
      [
        "holder",
        "activeProfile",
        "active",
        4,
        "Restored private name",
        "Private original active biography",
      ],
      [
        "revoked",
        "disabledProfile",
        "disabled",
        4,
        "Disabled private name",
        "Private original disabled biography",
      ],
    ] as const) {
      await pool.query(
        "insert into member_profiles.profiles(account_id,public_profile_id,display_name,bio,status,version,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'2020-01-01','2020-01-04T12:00:00Z')",
        [id(who), id(profile), name, bio, status, version],
      );
    }
    for (const [avatar, who, referenced, state] of [
      ["activeAvatar", "holder", true, "ready"],
      ["disabledAvatar", "revoked", true, "ready"],
      ["orphanAvatar", "holder", false, "failed"],
    ] as const) {
      await pool.query(
        "insert into member_profiles.avatars(id,account_id,state,failure_code,currently_referenced,orphaned_at,cleanup_claimed_at,ready_at,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,'2020-01-02','2020-01-30')",
        [
          id(avatar),
          id(who),
          state,
          state === "failed" ? "storage_failure" : null,
          referenced,
          new Date(referenced ? "2020-01-02" : "2020-01-29"),
          referenced ? null : new Date("2020-01-30"),
          referenced ? new Date("2020-01-03") : null,
        ],
      );
      for (const size of [160, 320, 640]) {
        await pool.query(
          "insert into member_profiles.avatar_renditions(avatar_id,size,content_type,byte_size,checksum_sha256,protected_object_key) values($1,$2,'image/webp',$3,$4,$5)",
          [
            id(avatar),
            size,
            size * 7,
            createHash("sha256")
              .update(`original-${avatar}-${String(size)}`)
              .digest("hex"),
            `account-profiles/${id(who)}/avatars/${id(avatar)}/${String(size)}.webp`,
          ],
        );
      }
    }
    for (const [who, avatar] of [
      ["holder", "activeAvatar"],
      ["revoked", "disabledAvatar"],
    ] as const) {
      await pool.query(
        "update member_profiles.profiles set avatar_id=$2 where account_id=$1",
        [id(who), id(avatar)],
      );
    }
    for (const [who, profile, events] of [
      [
        "holder",
        "activeProfile",
        [
          "profile_created",
          "avatar_uploaded",
          "profile_disabled",
          "profile_restored",
        ],
      ],
      [
        "revoked",
        "disabledProfile",
        [
          "profile_created",
          "avatar_uploaded",
          "profile_updated",
          "profile_disabled",
        ],
      ],
    ] as const) {
      for (const [index, event] of events.entries()) {
        await pool.query(
          "insert into member_profiles.audit_events(id,event,account_id,public_profile_id,created_at) values($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            event,
            id(who),
            id(profile),
            new Date(`2020-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`),
          ],
        );
      }
    }
    await pool.query(
      "insert into accounts.account_permissions(account_id,permission) values($1,'platform:admin')",
      [id("owner")],
    );
    await pool.query(
      "insert into accounts.legal_acceptances(id,account_id,operation_id,context_ref,kind,document_id,document_version,document_digest,document_text,document_url,accepted_at,screen,button_label) values($1,$2,$3,$4,'terms','original-purchase','2020',$5,$6,'https://example.test/legal/original','2020-01-31','checkout','Оплатить')",
      [
        id("acceptance"),
        id("holder"),
        randomUUID(),
        id("sent"),
        acceptedHash,
        acceptedText,
      ],
    );
    await pool.query(
      "insert into materials.series(id,slug,name,source_id,programme_explicit) values($1,'mixed-restore-product','Historical Product','fixture:product',true)",
      [id("product")],
    );
    await pool.query(
      "insert into materials.materials(id,title,summary,created_by,body,schema_version,access,publication_state,content_version,source_id,source_revision,source_path) values($1,'Original Material','Original summary',$2,'{\"type\":\"doc\",\"content\":[]}',1,'free','draft',7,'fixture:lesson',$3,'lesson.md')",
      [id("material"), id("owner"), "a".repeat(64)],
    );
    await pool.query(
      "insert into materials.product_chapters(id,product_id,name,summary,ordinal) values($1,$2,'Original chapter','Original summary',1)",
      [id("chapter"), id("product")],
    );
    await pool.query(
      "insert into materials.series_memberships(series_id,material_id,ordinal,chapter_id) values($1,$2,1,$3)",
      [id("product"), id("material"), id("chapter")],
    );
    for (const [index, placement] of ["placement1", "placement2"].entries())
      await pool.query(
        "insert into materials.product_programme_placements(id,product_id,material_id,chapter_id,ordinal) values($1,$2,$3,$4,$5)",
        [
          id(placement),
          id("product"),
          id("material"),
          id("chapter"),
          index + 1,
        ],
      );
    await pool.query(
      "insert into account_rights.access_receipts(scope,operation_id,fingerprint,result,payload,created_at) values('mixed-restore',$1,$2,$3,$3,'2020-01-31')",
      [id("receipt"), "b".repeat(64), acceptance],
    );
    await pool.query(
      "insert into account_rights.access_grants(id,account_id,source,source_ref,capabilities,coverage,starts_at,valid_until,revision,reason) values($1,$2,'manual','original-owner-grant',$3,$4,'2020-01-31',null,1,'Original owner grant')",
      [
        randomUUID(),
        id("holder"),
        [`product:${id("product")}`],
        { productIds: [id("product")], materialIds: [] },
      ],
    );
    for (const who of ["revoked", "orphan"])
      await pool.query(
        "insert into account_rights.product_access_exclusions(account_id,product_id,grant_ids,bridge,actor_id,reason,revoked_at) values($1,$2,'{}',false,$3,'Original owner refusal','2020-03-01')",
        [id(who), id("product"), id("owner")],
      );
    for (const state of ["sent", "unknown", "confirmed", "paid"]) {
      const quote = randomUUID();
      const buyer = state === "confirmed" ? id("revoked") : id(`${state}Buyer`);
      const bankState = state === "paid" ? "confirmed" : state;
      await pool.query(
        "insert into billing.price_quotes(id,account_id,operation_id,fingerprint,snapshot,created_at,expires_at) values($1,$2,$3,'historical-mixed',$4,'2020-01-31','2040-01-31')",
        [quote, buyer, randomUUID(), snapshot],
      );
      await pool.query(
        "insert into billing.purchases(id,account_id,quote_ref,kind,state,lifecycle_active,environment,terminal_ref,payment_id,amount_kopecks,snapshot,acceptance,contact,fiscalization,confirmed_at,created_at,updated_at) values($1,$2,$3,'one_time',$4,false,'demo','RESTOREDEMO',$5,234567,$6,$7,$8,'pending',$9,'2020-01-31','2020-01-31')",
        [
          id(state),
          buyer,
          quote,
          bankState,
          `bank-${id(state)}`,
          snapshot,
          acceptance,
          { email: "original@example.test" },
          bankState === "confirmed" ? "2020-01-31" : null,
        ],
      );
      await pool.query(
        "insert into billing.purchase_commands(account_id,operation_id,fingerprint,purchase_ref) values($1,$2,$3,$4)",
        [buyer, randomUUID(), "a".repeat(64), id(state)],
      );
      await pool.query(
        "insert into billing.promo_reservations(purchase_ref,account_id,quote_ref,state,snapshot) values($1,$2,$3,$4,$5)",
        [
          id(state),
          buyer,
          quote,
          bankState === "confirmed" ? "confirmed" : "unknown",
          snapshot,
        ],
      );
    }
    const recurringQuote = randomUUID();
    const recurringSnapshot = {
      ...snapshot,
      paymentOption: { ...snapshot.paymentOption, mode: "subscription" },
    };
    await pool.query(
      "insert into billing.price_quotes(id,account_id,operation_id,fingerprint,snapshot,created_at,expires_at) values($1,$2,$3,'legacy-recurring',$4,'2020-01-31','2040-01-31')",
      [recurringQuote, id("recurringBuyer"), randomUUID(), recurringSnapshot],
    );
    await pool.query(
      "insert into billing.purchases(id,account_id,quote_ref,kind,state,lifecycle_active,environment,terminal_ref,amount_kopecks,snapshot,acceptance,contact,fiscalization,created_at,updated_at) values($1,$2,$3,'initial','prepared',true,'demo','RESTOREDEMO',234567,$4,$5,$6,'pending','2020-01-31','2020-01-31')",
      [
        id("recurring"),
        id("recurringBuyer"),
        recurringQuote,
        recurringSnapshot,
        acceptance,
        { email: "original@example.test" },
      ],
    );
    await pool.query(
      "insert into billing.payment_events(id,purchase_ref,kind,payload,occurred_at,recorded_at) values($1,$2,'confirmed',$3,'2020-01-31','2020-01-31')",
      [
        id("paidEvent"),
        id("paid"),
        { bankPaymentId: `bank-${id("paid")}`, amountKopecks: 234567 },
      ],
    );
    await pool.query(
      "insert into billing.fulfillment_outbox(event_ref,purchase_ref,payload,next_attempt_at) values($1,$2,$3,'2020-01-31')",
      [id("paidEvent"), id("paid"), { original: "pending first grant" }],
    );
    await pool.query(
      "insert into billing.offers(id,name,benefits,benefit_periods,published,revision) values($1,'Original commercial offer',$2,$3,true,7)",
      [
        snapshot.offer.id,
        [`product:${id("product")}`],
        JSON.stringify([{ capability: "support", months: 3 }]),
      ],
    );
    await pool.query(
      "insert into billing.payment_options(id,offer_id,revision,months,price_kopecks,mode) values($1,$2,3,3,234567,'one_time')",
      [snapshot.paymentOption.id, snapshot.offer.id],
    );
    await pool.query(
      "insert into billing.promotions(id,revision,name,percent,starts_at,ends_at,offer_ids,payment_option_ids) values($1,2,'Original restricted promotion',15,'2020-01-01','2040-01-01',$2,$3)",
      [
        randomUUID(),
        [snapshot.offer.id],
        [snapshot.paymentOption.id, randomUUID()],
      ],
    );
    await pool.query(
      "insert into billing.payment_events(id,purchase_ref,kind,payload,occurred_at,recorded_at) values($1,$2,'confirmed',$3,'2020-01-31','2020-01-31')",
      [
        id("event"),
        id("confirmed"),
        { bankPaymentId: `bank-${id("confirmed")}`, amountKopecks: 234567 },
      ],
    );
    await pool.query(
      "insert into billing.fulfillment_outbox(event_ref,purchase_ref,payload,next_attempt_at) values($1,$2,$3,'2020-01-31')",
      [id("event"), id("confirmed"), { original: "pending fulfillment" }],
    );
    await pool.query(
      "insert into reading_activity.material_states(account_id,material_id,is_read,read_at,version,updated_at) values($1,$2,true,'2020-01-31',9,'2020-01-31')",
      [id("holder"), id("material")],
    );
    await pool.query(
      "insert into bookmarks.bookmarked_materials(account_id,material_id,bookmarked_at) values($1,$2,'2020-01-31')",
      [id("holder"), id("material")],
    );
    await pool.query(
      "insert into videos.videos(id,material_id,created_by,access,project_id,provider_video_id,title,origin,provider_status,state,ready_at,provider_embed_locator) values($1,$2,$3,'free','synthetic','original-provider-video','Original video','platform_upload','ready','ready','2020-01-31','https://video.example.test/original')",
      [id("video"), id("material"), id("owner")],
    );
    await pool.query(
      "insert into videos.playback_progress(account_id,video_id,position_seconds,duration_seconds,updated_at) values($1,$2,47,100,'2020-01-31')",
      [id("holder"), id("video")],
    );
  } finally {
    await pool.end();
  }
  const prisma = createPrismaClient(url);
  try {
    const definition = {
      schemaVersion: 1 as const,
      situation: "Accepted situation",
      result: ["Accepted outcome"],
      freedom: "Accepted freedom",
      criteria: [
        {
          id: "evidence",
          level: "required" as const,
          requirement: "Accepted requirement",
          acceptableEvidence: ["Saved evidence"],
        },
      ],
    };
    const acceptedSourceBody = materialBodyOperations.accept(
      originalSourceRequest.body,
      { assignMissingNodeIds: false },
    );
    if (!acceptedSourceBody.ok) throw new Error(acceptedSourceBody.error.code);
    await prisma.$executeRaw(
      Prisma.sql`insert into materials.materials(id,title,access,publication_state,content_version,source_id,source_path,source_revision,show_in_feed,schema_version,body,created_by) values (${id("historicalSource")}::uuid,'Original Source','free','draft',8,${originalSourceRequest.source.id},${originalSourceRequest.source.path},${originalSourceRequest.source.revision},false,1,${JSON.stringify(originalSourceRequest.body.doc)}::jsonb,${id("owner")}::uuid)`,
    );
    await prisma.authoringIdempotency.create({
      data: {
        actorId: id("owner"),
        operation: "save_material",
        idempotencyKey: "original-source",
        requestFingerprint: fingerprintCommand({
          operation: "save_material",
          ...originalSourceRequest,
          body: acceptedSourceBody.value,
          deleteVideoId: null,
          videoChapters: null,
          confirmedProductRemovals: [],
        }),
        materialId: id("historicalSource"),
        contentVersion: 8n,
        publicationState: "draft",
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.productTask.create({
        data: {
          id: id("task"),
          code: "requirements",
          sourceId: "fixture:requirements",
          productId: id("product"),
          chapterId: id("chapter"),
          position: 1,
          title: "Accepted Task v2",
          access: "free",
          publicationState: "unpublished",
          createdAt: new Date("2020-01-31"),
          updatedAt: new Date("2020-01-31"),
          currentVersion: 2,
          revision: 5,
          programmeVisibility: "embedded",
          embeddedMaterialId: id("material"),
          relatedMaterialSourceIds: [],
        },
      });
      for (const version of [1, 2]) {
        await tx.productTaskVersion.create({
          data: {
            taskId: id("task"),
            version,
            definition,
            definitionDigest: taskDefinitionDigest(definition),
            sourceRepository: "fixture/current",
            sourceCommit: "c".repeat(40),
            sourcePath: "accepted.md",
            createdAt: new Date("2020-01-31"),
          },
        });
        const submissionId = randomUUID();
        await tx.productTaskSubmission.create({
          data: {
            id: submissionId,
            accountId: id("revoked"),
            taskId: id("task"),
            taskVersion: version,
            submissionKey: `saved-${String(version)}`,
            requestFingerprint: commandDigest({
              source: "form",
              code: "requirements",
              taskVersion: version,
              submissionKey: `saved-${String(version)}`,
              reportText: `Original v${String(version)} report`,
              note: "Original note",
            }),
            source: "form",
            reportText: `Original v${String(version)} report`,
            note: "Original note",
            submittedAt: new Date("2020-01-31"),
          },
        });
        await tx.productTaskAuthorFeedback.create({
          data: {
            submissionId,
            comment: "Separate original feedback",
            updatedBy: id("owner"),
            updatedAt: new Date("2020-01-31"),
          },
        });
      }
      await tx.productTaskReviewProgress.create({
        data: {
          accountId: id("revoked"),
          taskId: id("task"),
          taskVersion: 2,
          runKey: randomUUID(),
          revision: 7,
          phase: "reviewing",
          summary: "Original review",
          requestFingerprint: "e".repeat(64),
          updatedAt: new Date("2020-01-31"),
        },
      });
      const legacyDefinition = originalPracticeDefinition;
      const source = {
        materialSourceId: "fixture:lesson",
        materialSourceRevision: "a".repeat(64),
      };
      await tx.$executeRaw(Prisma.sql`
        insert into materials.practice_definitions(practice_id,material_id,definition,definition_digest,practice_version,bound_source_id,bound_source_revision,bound_content_version,publication_state,source_repository,source_commit,source_path,updated_at)
        values ('fixture:requirements',${id("material")}::uuid,${JSON.stringify(legacyDefinition)}::jsonb,${practiceDefinitionDigest(legacyDefinition, source)},19,${source.materialSourceId},${source.materialSourceRevision},7,'unpublished','fixture/legacy',${"f".repeat(40)},'legacy.json','2020-01-31')
      `);
      for (const [index, label] of (
        [
          "migrated",
          "unowned",
          "ambiguous",
          "unsupported_identity",
          "source-collision",
        ] as const
      ).entries()) {
        const materialId = randomUUID();
        const sourceReference = {
          materialSourceId:
            label === "source-collision"
              ? "fixture:source-collision"
              : `fixture:lesson-${label}`,
          materialSourceRevision: "a".repeat(64),
        };
        await tx.$executeRaw(
          Prisma.sql`insert into materials.materials(id,title,summary,created_by,body,schema_version,access,publication_state,content_version,source_id,source_revision,source_path) values(${materialId}::uuid,'Passive fixture','',${id("owner")}::uuid,'{"type":"doc","content":[]}'::jsonb,1,'free','draft',7,${sourceReference.materialSourceId},${sourceReference.materialSourceRevision},'legacy.md')`,
        );
        if (label !== "unowned") {
          await tx.$executeRaw(
            Prisma.sql`insert into materials.series_memberships(series_id,material_id,ordinal,chapter_id) values(${id("product")}::uuid,${materialId}::uuid,${index + 2},${id("chapter")}::uuid)`,
          );
          await tx.$executeRaw(
            Prisma.sql`insert into materials.product_programme_placements(id,product_id,material_id,chapter_id,ordinal) values(${randomUUID()}::uuid,${id("product")}::uuid,${materialId}::uuid,${id("chapter")}::uuid,${20 + 2 * index})`,
          );
        }
        if (label === "ambiguous") {
          const chapter = randomUUID();
          await tx.$executeRaw(
            Prisma.sql`insert into materials.product_chapters(id,product_id,name,summary,ordinal) values(${chapter}::uuid,${id("product")}::uuid,'Ambiguous chapter','',2)`,
          );
          await tx.$executeRaw(
            Prisma.sql`insert into materials.product_programme_placements(id,product_id,material_id,chapter_id,ordinal) values(${randomUUID()}::uuid,${id("product")}::uuid,${materialId}::uuid,${chapter}::uuid,${21 + 2 * index})`,
          );
        }
        await tx.$executeRaw(Prisma.sql`
          insert into materials.practice_definitions(practice_id,material_id,definition,definition_digest,practice_version,bound_source_id,bound_source_revision,bound_content_version,publication_state,source_repository,source_commit,source_path,updated_at)
          values(${`fixture:${label}`},${materialId}::uuid,${JSON.stringify(legacyDefinition)}::jsonb,${practiceDefinitionDigest(legacyDefinition, sourceReference)},19,${sourceReference.materialSourceId},${sourceReference.materialSourceRevision},7,'unpublished','fixture/legacy',${"f".repeat(40)},'legacy.json','2020-01-31')
        `);
      }
      await tx.practiceImportReceipt.create({
        data: {
          actorId: id("owner"),
          operation: "apply_source_practice",
          idempotencyKey: "original-practice",
          requestFingerprint: fingerprintCommand({
            operation: "apply_source_practice",
            ...originalPracticeCommand,
          }),
          receipt: originalPracticeReceipt,
        },
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function state(database: RestoreDatabase) {
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    return await snapshotDatabase((query) => pool.query(query));
  } finally {
    await pool.end();
  }
}

const preservedTables = [
  "accounts.accounts",
  "accounts.account_permissions",
  "accounts.legal_acceptances",
  "billing.price_quotes",
  "billing.offers",
  "billing.payment_options",
  "billing.payment_events",
  "account_rights.access_grants",
  "materials.practice_import_receipts",
  "materials.authoring_idempotency",
  "product_tasks.tasks",
  "product_tasks.task_versions",
  "product_tasks.submissions",
  "product_tasks.author_feedback",
  "product_tasks.review_progress",
  "reading_activity.material_states",
  "bookmarks.bookmarked_materials",
  "videos.playback_progress",
  "public.platform_migrations",
] as const;
async function preservedFacts(
  before: Awaited<ReturnType<typeof state>>,
  database: RestoreDatabase,
  originalSourceRecords: readonly { material_id: string; original: unknown }[],
) {
  const after = await state(database);
  for (const table of preservedTables) {
    expect(before.tables[table], table).not.toHaveLength(0);
    expect(after.tables[table], table).toEqual(
      expect.arrayContaining([...(before.tables[table] ?? [])]),
    );
  }
  expect(after.tables["materials.historical_practice_definitions"]).toEqual(
    before.tables["materials.practice_definitions"],
  );
  expect(after.tables["materials.practice_definitions"]).toBeUndefined();
  for (const table of [
    "profiles",
    "avatars",
    "avatar_renditions",
    "audit_events",
  ]) {
    const original = before.tables[`member_profiles.${table}`];
    expect(original, table).not.toHaveLength(0);
    expect(after.tables[`account_profiles.${table}`], table).toEqual(original);
    expect(after.tables[`member_profiles.${table}`], table).toBeUndefined();
  }
  const pool = new Pool({ connectionString: database.url, max: 1 });
  try {
    expect(
      (
        await pool.query(
          "select material_id,original from materials.historical_source_records order by material_id",
        )
      ).rows,
    ).toEqual(originalSourceRecords);
    expect(
      (
        await pool.query(
          "select column_name from information_schema.columns where table_schema='materials' and table_name='materials' and column_name='show_in_feed'",
        )
      ).rows,
    ).toEqual([]);
    const audit = await pool.query<{
      practice_id: string;
      disposition: string;
      original: Record<string, unknown>;
      import_receipts: unknown[];
    }>(
      "select practice_id,disposition,original,import_receipts from product_tasks.legacy_practice_migrations order by practice_id",
    );
    expect(
      audit.rows.map(({ practice_id, disposition }) => ({
        practice_id,
        disposition,
      })),
    ).toEqual([
      { practice_id: "fixture:ambiguous", disposition: "ambiguous_ownership" },
      { practice_id: "fixture:migrated", disposition: "migrated" },
      { practice_id: "fixture:requirements", disposition: "existing_task" },
      {
        practice_id: "fixture:source-collision",
        disposition: "unsupported_identity",
      },
      { practice_id: "fixture:unowned", disposition: "unowned" },
      {
        practice_id: "fixture:unsupported_identity",
        disposition: "unsupported_identity",
      },
    ]);
    expect(audit.rows.map((row) => row.original)).toEqual(
      expect.arrayContaining(
        (before.tables["materials.practice_definitions"] ?? []).map(
          (row): unknown => JSON.parse(row),
        ),
      ),
    );
    const promotionInventory = await pool.query<{ source: unknown }>(
      "select source from billing.promotion_migration_inventory order by promotion_id",
    );
    expect(promotionInventory.rows.map((row) => row.source)).toEqual(
      (before.tables["billing.promotions"] ?? []).map((row): unknown =>
        JSON.parse(row),
      ),
    );
    const existingAudit = audit.rows.find(
      (row) => row.practice_id === "fixture:requirements",
    );
    expect(existingAudit?.original).toMatchObject({
      practice_version: 19,
      bound_content_version: 7,
    });
    expect(existingAudit?.import_receipts).toEqual(
      (before.tables["materials.practice_import_receipts"] ?? []).map(
        (row): unknown => JSON.parse(row),
      ),
    );
    const conditions = await pool.query<{ acceptance: unknown }>(
      "select id,account_id,quote_ref,kind,environment,terminal_ref,payment_id,amount_kopecks,snapshot,acceptance,contact from billing.purchases order by id",
    );
    expect(conditions.rows).toHaveLength(5);
    for (const row of conditions.rows)
      expect(row.acceptance).toEqual(acceptance);
    await expect(
      pool.query(
        "update accounts.legal_acceptances set document_text='rewritten' where id=$1",
        [id("acceptance")],
      ),
    ).rejects.toThrow(/immutable/u);
    await expect(
      pool.query(
        "delete from product_tasks.legacy_practice_migrations where practice_id='fixture:requirements'",
      ),
    ).rejects.toThrow(/immutable/u);
  } finally {
    await pool.end();
  }
}

async function recover(
  database: RestoreDatabase,
  external: ReturnType<typeof createExternalEffects>,
  expectedApplied: number | null = 0,
) {
  const { prisma, refused } = guardTransactionConnections(
    createPrismaClient(database.url),
  );
  try {
    const unexpectedStorage = () => {
      external.storage++;
      throw new Error(
        "Profile restore readers must not access external object storage",
      );
    };
    const profiles = assembleAccountProfiles({
      prisma,
      signedGetTtlSeconds: 60,
      objectStorage: {
        putImmutable: unexpectedStorage,
        read: unexpectedStorage,
        delete: unexpectedStorage,
        signGet: unexpectedStorage,
      },
    });
    for (const [who, name, bio, status, version, avatar] of [
      [
        "holder",
        "Restored private name",
        "Private original active biography",
        "active",
        4,
        "activeAvatar",
      ],
      [
        "revoked",
        "Disabled private name",
        "Private original disabled biography",
        "disabled",
        4,
        "disabledAvatar",
      ],
    ] as const) {
      expect(await profiles.readPrivateProfile(accountId(id(who)))).toEqual({
        ok: true,
        value: {
          kind: "profile",
          profile: {
            displayName: name,
            bio,
            status,
            version,
            avatar: { avatarId: id(avatar) },
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-04T12:00:00.000Z",
          },
        },
      });
    }
    // A different Account cannot select the owner's profile by opaque Profile ID or avatar ID.
    expect(await profiles.readPrivateProfile(accountId(id("orphan")))).toEqual({
      ok: true,
      value: { kind: "missing" },
    });
    for (const [who, avatar] of [
      ["orphan", "activeAvatar"],
      ["revoked", "activeAvatar"],
      ["holder", "orphanAvatar"],
      ["revoked", "disabledAvatar"],
    ] as const) {
      expect(
        await profiles.deliverAvatar({
          accountId: accountId(id(who)),
          avatarId: id(avatar),
          size: 320,
        }),
      ).toEqual({ ok: false, error: { code: "not_found" } });
    }
    expect(
      await moderateAccountProfile(prisma, id("disabledProfile"), "disable"),
    ).toEqual({
      ok: true,
      changed: false,
      status: "disabled",
      publicProfileId: id("disabledProfile"),
    });
    expect(
      await new AccountNames(prisma).read([
        id("holder"),
        id("revoked"),
        id("orphan"),
      ]),
    ).toEqual({
      ok: true,
      names: new Map([[id("holder"), "Restored private name"]]),
    });
    expect(external.storage).toBe(0);
    const historicalAuthoring = assembleMaterials({
      prisma,
      authorPolicy: { canManage: (actor) => actor === id("owner") },
    }).authoring;
    expect(
      await historicalAuthoring.readHistoricalSourceMaterialReceipt(
        originalSourceCommand,
      ),
    ).toEqual({
      ok: true,
      value: {
        materialId: id("historicalSource"),
        contentVersion: 8,
        publicationState: "draft",
        publishedAt: null,
      },
    });
    expect(
      await historicalAuthoring.readHistoricalSourceMaterialReceipt({
        ...originalSourceCommand,
        source: { ...originalSourceCommand.source, showInFeed: true },
      }),
    ).toEqual({ ok: false, error: { code: "idempotency_conflict" } });
    expect(
      await historicalAuthoring.readHistoricalSourceMaterialReceipt({
        ...originalSourceCommand,
        actor: id("orphan"),
      }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(
      await historicalAuthoring.readHistoricalSourceMaterialReceipt({
        ...originalSourceCommand,
        idempotencyKey: "new-source-write",
      }),
    ).toEqual({ ok: false, error: { code: "historical_receipt_not_found" } });
    expect(
      await historicalAuthoring.readHistoricalPracticeReceipt(
        originalPracticeCommand,
      ),
    ).toEqual({ ok: true, value: originalPracticeReceipt });
    expect(
      await historicalAuthoring.readHistoricalPracticeReceipt({
        ...originalPracticeCommand,
        expectedPracticeVersion: 19,
      }),
    ).toEqual({ ok: false, error: { code: "idempotency_conflict" } });
    expect(
      await historicalAuthoring.readHistoricalPracticeReceipt({
        ...originalPracticeCommand,
        actor: id("orphan"),
      }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(
      await historicalAuthoring.readHistoricalPracticeReceipt({
        ...originalPracticeCommand,
        idempotencyKey: "new-practice-write",
      }),
    ).toEqual({ ok: false, error: { code: "practice_definition_retired" } });
    const sourceState = await historicalAuthoring.readSourceMaterialState({
      actor: id("owner"),
      namespace: "fixture",
    });
    if (!sourceState.ok) throw new Error(sourceState.error.code);
    expect(sourceState.value.materials).toHaveLength(7);
    expect(
      sourceState.value.materials.find(
        (material) => material.materialId === id("historicalSource"),
      ),
    ).toEqual({
      sourceId: originalSourceRequest.source.id,
      materialId: id("historicalSource"),
      slug: null,
      contentVersion: 8,
      access: "free",
      publicationState: "draft",
      source: {
        version: 2,
        path: "original.md",
        revision: "c".repeat(64),
        commit: null,
      },
      memberships: [],
    });
    expect(
      sourceState.value.materials.find(
        (material) => material.materialId === id("material"),
      )?.memberships,
    ).toEqual([
      { productId: id("product"), ordinal: 1, chapterId: id("chapter") },
    ]);
    const accounts = assembleAccounts({
      prisma,
      emailFingerprintKey: "synthetic-restore-fingerprint-000000000000",
    });
    const catalog = new CoverageCatalog(prisma, new ProductDiscovery(prisma));
    const grants = assembleAccessGrants({
      prisma,
      accounts,
      contentCatalog: catalog,
      clock: () => instant,
    });
    const config = syntheticTbankConfig({
      environment: "demo",
      terminalKey: "RESTOREDEMO",
      password: "synthetic-only",
      bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"),
      minimumKopecks: 100,
      maximumKopecks: 1_000_000,
      returnUrl: "https://example.test/account",
      notificationUrl: "https://example.test/notify",
      receipt: { taxation: "usn_income", tax: "none" },
    });
    const payments = new BillingPayments({
      prisma,
      grants,
      contact: new BillingContact({
        prisma,
        protection: billingContactProtection(
          Buffer.alloc(32, 42).toString("base64"),
        ),
        documents: [],
        now: () => instant,
        sendCode: () => Promise.resolve(),
      }),
      clock: () => instant,
      bank: new Tbank(config, (url, init) => {
        if (url.endsWith("/Init")) external.init++;
        if (url.endsWith("/Charge")) external.charges++;
        if (!url.endsWith("/GetState"))
          throw new Error(
            "A restored historical payment must never initiate a bank effect",
          );
        const body: unknown = JSON.parse(init.body);
        if (
          typeof body !== "object" ||
          body === null ||
          !("PaymentId" in body) ||
          typeof body.PaymentId !== "string"
        )
          throw new Error("Expected exact retained payment identity");
        external.states.push(body.PaymentId);
        expect([`bank-${id("sent")}`, `bank-${id("unknown")}`]).toContain(
          body.PaymentId,
        );
        if (body.PaymentId === `bank-${id("unknown")}`)
          throw new Error("Synthetic unresolved bank response");
        return Promise.resolve(
          Response.json({
            TerminalKey: "RESTOREDEMO",
            OrderId: body.PaymentId.slice(5),
            PaymentId: body.PaymentId,
            Amount: 234567,
            Status: "NEW",
            Success: true,
            ErrorCode: "0",
          }),
        );
      }),
    });
    if (expectedApplied === null) {
      // A legacy archive can have lost post-backup external receipts. Workers remain stopped;
      // constructing the public readers does not grant permission to execute its pending queue.
      expect(
        await payments.status(id("unknownBuyer"), id("unknown")),
      ).toMatchObject({ ok: true, value: { state: "unknown", snapshot } });
      expect(await payments.status(id("paidBuyer"), id("paid"))).toMatchObject({
        ok: true,
        value: { state: "confirmed", snapshot },
      });
      expect(
        await assembleAccountRights({
          prisma,
          clock: () => instant,
        }).resolveForAccess(accountId(id("paidBuyer")), [id("product")]),
      ).toEqual({ kind: "required" });
      expect(
        await prisma.billingFulfillment.findUnique({
          where: { eventRef: id("paidEvent") },
        }),
      ).toMatchObject({ appliedAt: null });
      expect(refused).toEqual([]);
      return;
    }
    expect(await payments.recover()).toMatchObject({
      ok: true,
      value: { applied: expectedApplied },
    });
    expect(
      await prisma.productAccess.count({ where: { productId: id("product") } }),
    ).toBe(4);
    expect(
      await prisma.productAccessSource.count({ where: { source: "purchase" } }),
    ).toBe(2);
    for (const [purchase, status, amount] of [
      ["paid", "PARTIAL_REFUNDED", 50000],
      ["confirmed", "REFUNDED", 234567],
    ] as const) {
      const body = {
        TerminalKey: "RESTOREDEMO",
        OrderId: id(purchase),
        PaymentId: `bank-${id(purchase)}`,
        Amount: amount,
        Status: status,
        Success: true,
        ErrorCode: "0",
      };
      expect(
        await payments.notification({
          ...body,
          Token: tbankToken(body, config.password),
        }),
      ).toMatchObject({ ok: true });
    }
    expect(await payments.status(id("paidBuyer"), id("paid"))).toMatchObject({
      ok: true,
      value: { refundedKopecks: null },
    });
    expect(await payments.status(id("revoked"), id("confirmed"))).toMatchObject(
      { ok: true, value: { refundedKopecks: 234567 } },
    );
    expect(
      await prisma.billingProductPrice.findUnique({
        where: { productId: id("product") },
      }),
    ).toMatchObject({ published: false, priceKopecks: 234567n });
    const rights = assembleAccountRights({ prisma, clock: () => instant });
    const materials = assembleMaterials({
      prisma,
      authorPolicy: { canManage: () => false },
    });
    const directory = new ProductDirectory(
      prisma,
      assembleProductMaterialReading(prisma),
    );
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      productTaskResourceFacts: assembleProductTaskResourceFacts(
        prisma,
        new ProductDiscovery(prisma),
      ),
      accountRights: rights,
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
    });
    const tasks = assembleLearningTasks({
      prisma,
      directory,
      contentAccess,
      submissionsEnabled: true,
      materialReader: materials.publishedMaterialReader,
    });
    const subject = {
      kind: "account" as const,
      accountId: accountId(id("revoked")),
    };
    const history = await tasks.submissions({ subject, code: "requirements" });
    if (!history.ok) throw new Error(history.error.code);
    expect(
      history.value.submissions
        .map(({ taskVersion, reportText, authorFeedback }) => ({
          taskVersion,
          reportText,
          comment: authorFeedback?.comment,
        }))
        .sort((a, b) => a.taskVersion - b.taskVersion),
    ).toEqual([
      {
        taskVersion: 1,
        reportText: "Original v1 report",
        comment: "Separate original feedback",
      },
      {
        taskVersion: 2,
        reportText: "Original v2 report",
        comment: "Separate original feedback",
      },
    ]);
    for (const version of [1, 2])
      expect(
        await tasks.submit({
          subject,
          source: "form",
          submission: {
            code: "requirements",
            taskVersion: version,
            submissionKey: `saved-${String(version)}`,
            reportText: `Original v${String(version)} report`,
            note: "Original note",
          },
        }),
      ).toMatchObject({ ok: true });
    expect(
      await tasks.submit({
        subject,
        source: "form",
        submission: {
          code: "requirements",
          taskVersion: 2,
          submissionKey: "new-revoked-submission",
          note: "Must not bypass access",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "task_not_available" } });
    expect(
      await tasks.submissions({
        subject: { kind: "account", accountId: accountId(id("unknownBuyer")) },
        code: "requirements",
      }),
    ).toMatchObject({ ok: false, error: { code: "task_not_available" } });

    expect(
      await rights.resolveForAccess(accountId(id("paidBuyer")), [
        id("product"),
      ]),
    ).toEqual({ kind: "active", validUntil: null });
    expect(
      await grants.readProductAccess(id("owner"), {
        accountId: id("paidBuyer"),
        productId: id("product"),
      }),
    ).toMatchObject({
      ok: true,
      value: { access: "active", firstIssuedAt: "2020-01-31T00:00:00.000Z" },
    });
    expect(
      await prisma.billingPurchase.findUnique({
        where: { id: id("recurring") },
      }),
    ).toMatchObject({ state: "failed", kind: "initial", paymentId: null });
    expect(
      await rights.resolveForAccess(accountId(id("holder")), [id("product")]),
    ).toEqual({ kind: "active", validUntil: null });
    expect(
      await rights.resolveForAccess(accountId(id("revoked")), [id("product")]),
    ).toEqual({ kind: "required" });
    expect(
      await grants.readProductAccess(id("owner"), {
        accountId: id("orphan"),
        productId: id("product"),
      }),
    ).toMatchObject({
      ok: true,
      value: { access: "revoked", firstIssuedAt: null },
    });
    expect(
      await prisma.billingFulfillment.findUnique({
        where: { eventRef: id("event") },
      }),
    ).toMatchObject({ appliedAt: instant });
    expect(
      await prisma.billingPurchase.findUnique({ where: { id: id("unknown") } }),
    ).toMatchObject({ state: "unknown", amountKopecks: 234567n, acceptance });
    expect(
      await prisma.productTask.findUnique({ where: { id: id("task") } }),
    ).toMatchObject({
      currentVersion: 2,
      revision: 5,
      title: "Accepted Task v2",
    });
    await expect(
      prisma.productTaskVersion.update({
        where: { taskId_version: { taskId: id("task"), version: 1 } },
        data: { sourcePath: "rewritten" },
      }),
    ).rejects.toThrow(/immutable/u);
    await expect(
      prisma.productTaskVersion.delete({
        where: { taskId_version: { taskId: id("task"), version: 1 } },
      }),
    ).rejects.toThrow(/immutable/u);
    expect(external).toMatchObject({ init: 0, charges: 0, telegram: 0 });
  } finally {
    await prisma.$disconnect();
  }
  expect(refused).toEqual([]);
}

test("full mixed legacy and recovered archives restore into empty databases and recover without repeating bank, access or history effects", async () => {
  // One ledger belongs to this complete restore scenario, across every fresh application owner.
  const external = createExternalEffects();
  let originalSourceRecords: { material_id: string; original: unknown }[] = [];
  expect(migrationRegistryIdentity(platformMigrations.slice(0, 103))).toBe(
    "sha256:4202eac8e733fe5f60198130a06eb9a4b4b46aafa05c7f2ebf642c78cf8e4468",
  );
  const source = await postgres.emptyDatabase();
  await runMigrationsToLatest(source.url, platformMigrations.slice(0, 103));
  await seedLegacy(source.url);
  const legacyPool = new Pool({ connectionString: source.url, max: 1 });
  try {
    originalSourceRecords = (
      await legacyPool.query<{ material_id: string; original: unknown }>(
        "select id as material_id,jsonb_build_object('id',source_id,'path',source_path,'revision',source_revision,'commit',null,'showInFeed',show_in_feed) as original from materials.materials where source_id is not null order by id",
      )
    ).rows;
    expect(originalSourceRecords.length).toBe(7);
  } finally {
    await legacyPool.end();
  }
  const legacyState = await state(source);
  const legacy = await postgres.backup(source);
  await migrateToLatest(source.url);
  await recover(source, external, 2);
  await preservedFacts(legacyState, source, originalSourceRecords);
  const recovered = await state(source);
  await recover(source, external);
  expect(await state(source)).toEqual(recovered);
  const upgraded = await postgres.backup(source);
  await expect(postgres.restore(upgraded, source)).rejects.toThrow(
    "completely empty",
  );
  const restored = await postgres.emptyDatabase();
  await postgres.restore(upgraded, restored);
  expect(await state(restored)).toEqual(recovered);
  await preservedFacts(legacyState, restored, originalSourceRecords);
  expect(await migrateToLatest(restored.url)).toEqual({
    appliedMigrations: [],
  });
  for (let pass = 0; pass < 2; pass++) {
    await recover(restored, external);
    expect(await state(restored)).toEqual(recovered);
  }
  const rolledBack = await postgres.emptyDatabase();
  await postgres.restore(legacy, rolledBack);
  expect(await state(rolledBack)).toEqual(legacyState);
  await migrateToLatest(rolledBack.url);
  await preservedFacts(legacyState, rolledBack, originalSourceRecords);
  const heldState = await state(rolledBack);
  const externalBeforeHold = structuredClone(external);
  for (let pass = 0; pass < 2; pass++) {
    await recover(rolledBack, external, null);
    expect(await state(rolledBack)).toEqual(heldState);
  }
  expect(external).toEqual(externalBeforeHold);
  expect(legacy.bytes).toBeGreaterThan(0);
  expect(upgraded.bytes).toBeGreaterThan(legacy.bytes);
  Object.assign(postgres.evidence, {
    image: postgres.image,
    versions: postgres.versions,
    legacy: {
      sha256: legacy.sha256,
      bytes: legacy.bytes,
      listing: legacy.listing,
    },
    upgraded: {
      sha256: upgraded.sha256,
      bytes: upgraded.bytes,
      listing: upgraded.listing,
    },
    commands: postgres.commands,
    external,
  });
});
