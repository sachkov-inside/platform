/** Runs an owning capability from an independently built artifact, in its own process. */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const load = (path) => import(pathToFileURL(resolve(job.dist, path)).href);
await import(
  pathToFileURL(
    resolve(
      job.context,
      "apps",
      job.app,
      "node_modules/reflect-metadata/Reflect.js",
    ),
  ).href
);
let close = async () => {};
try {
  let result;
  if (job.app === "backend") {
    if (job.operation === "product-access-parse") {
      const path = "modules/account-rights/domain/product-access.js";
      if (!existsSync(resolve(job.dist, path))) {
        result = { accepted: false, reason: "product_access_contract_absent" };
      } else {
        const { productAccessViewSchema } = await load(path);
        result = {
          accepted: productAccessViewSchema.safeParse(job.input).success,
        };
      }
    } else if (job.operation === "migrate") {
      result = await (
        await load("migrations/index.js")
      ).migrateToLatest(job.databaseUrl);
    } else {
      const { createPrismaClient } = await load(
        "infrastructure/prisma/index.js",
      );
      const prisma = createPrismaClient(job.databaseUrl);
      close = () => prisma.$disconnect();
      if (job.operation.startsWith("task-")) {
        const material = await load("modules/materials/index.js");
        const products =
          job.variant === "legacy"
            ? material
            : await load("modules/products/index.js");
        const directory = new products.ProductDirectory(
          prisma,
          material.assembleProductMaterialReading?.(prisma),
        );
        const { assembleProductTaskImport } = await load(
          "modules/product-tasks/facets/product-task-import/product-task-import.js",
        );
        const capability = assembleProductTaskImport({
          prisma,
          directory,
          authorPolicy: { canManage: async () => true },
          clock: () => new Date("2026-10-24T05:00:00Z"),
        });
        result = await capability[
          job.operation === "task-apply" ? "apply" : "validate"
        ](job.input, { actor: job.actor, idempotencyKey: job.key });
      } else if (job.operation === "source-apply") {
        const { assembleMaterials } = await load(
          job.variant === "legacy"
            ? "modules/materials/assemble-materials.js"
            : "entrypoints/composition/assemble-materials.js",
        );
        const { authoring } = assembleMaterials({
          prisma,
          authorPolicy: { canManage: async () => true },
        });
        const reservation = await authoring.reserveSourceMaterial({
          source: job.input.source,
          actor: job.actor,
        });
        if (!reservation.ok)
          throw new Error(
            `Source reservation failed: ${JSON.stringify(reservation)}`,
          );
        result = await authoring.applySourceMaterial({
          ...job.input,
          materialId: reservation.value.materialId,
          expectedContentVersion: 1,
          actor: job.actor,
          idempotencyKey: job.key,
        });
      } else if (job.operation === "historical-source-receipt") {
        const { assembleReadHistoricalSourceMaterialReceipt } = await load(
          "modules/materials/features/read-historical-source-receipt/read-historical-source-receipt.js",
        );
        const { materialBodyOperations } = await load(
          "modules/materials/index.js",
        );
        result = await assembleReadHistoricalSourceMaterialReceipt({
          prisma,
          authorPolicy: { canManage: async () => true },
          materialBodyOperations,
        })({ ...job.input, actor: job.actor, idempotencyKey: job.key });
      } else throw new Error("Unknown Backend job");
    }
  } else if (job.app === "telegram") {
    if (job.operation === "own-access") {
      const { HttpActivationPlatform } = await load(
        "adapters/platform/http-activation-platform.adapter.js",
      );
      const adapter = new HttpActivationPlatform(
        job.endpoint,
        "synthetic-transfer-secret",
      );
      const response = await adapter.own(job.binding);
      result = { accepted: response !== undefined, response: response ?? null };
    } else {
      const { createDatabase } = await load("database/create-database.js");
      const database = createDatabase(job.databaseUrl);
      close = () => database.destroy();
      if (job.operation === "migrate")
        result = await (
          await load("database/migrator.js")
        ).migrateToLatest(database);
      else {
        const { loadApplicationConfig } = await load(
          "config/application-config.js",
        );
        const config = loadApplicationConfig({
          DATABASE_URL: job.databaseUrl,
          TELEGRAM_BOT_IDENTITY: "transfer",
          TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
          TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
          PLATFORM_INTEGRATION_SECRET:
            "synthetic_platform_secret_for_tests_only",
          PLATFORM_COMMUNICATIONS_SECRET:
            "synthetic_communications_secret_for_tests",
          TELEGRAM_WELCOME_TEXT: "Welcome",
          TELEGRAM_LINK_RECEIPT_TEXT: "Receipt",
          TELEGRAM_LINKED_MEMBER_TEXT: "Member",
          TELEGRAM_LINKED_NON_MEMBER_TEXT: "Nonmember",
          TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Unavailable",
          WORKERS_ENABLED: "false",
        });
        const contract = await load(
          "modules/communications/communications-contract.js",
        );
        if (!contract.validRequest(job.input))
          result = { accepted: false, code: "invalid_request_shape" };
        else {
          const module = await load(
            job.variant === "legacy"
              ? "modules/communications/funnels.js"
              : "modules/communications/communication-sequences.js",
          );
          const Capability = module.Funnels ?? module.CommunicationSequences;
          const capability = new Capability(
            database,
            config,
            { authorize: async () => "allowed" },
            { now: () => new Date("2026-10-24T05:00:00Z") },
            { validate: async () => ({ status: "ok", targetErrors: [] }) },
          );
          result = {
            accepted: true,
            value: await capability.execute(job.input),
          };
        }
      }
    }
  } else throw new Error("Unknown artifact application");
  process.stdout.write(
    "ARTIFACT_RESULT=" +
      JSON.stringify({
        pid: process.pid,
        app: job.app,
        variant: job.variant,
        result,
      }) +
      "\n",
  );
} finally {
  await close();
}
