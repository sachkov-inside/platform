import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { createPrismaClient } from "../../../../apps/backend/src/infrastructure/prisma/index.js";
import { migrateToLatest } from "../../../../apps/backend/src/migrations/index.js";
import { accountId } from "../../../../apps/backend/src/modules/accounts/index.js";
import { MemberNames } from "../../../../apps/backend/src/modules/member-profiles/index.js";
import { TelegramAccountLinks } from "../../../../apps/backend/src/modules/telegram-membership/index.js";
import { assembleAccountRights } from "../../../../apps/backend/src/modules/account-rights/index.js";
import { assembleContentAccess } from "../../../../apps/backend/src/modules/content-access/index.js";
import {
  assembleMaterials,
  ProductDirectory,
  assembleMaterialResourceFacts,
} from "../../../../apps/backend/src/modules/materials/index.js";
import { assembleProductTaskResourceFacts } from "../../../../apps/backend/src/modules/product-tasks/adapters/content-access/product-task-resource-facts.js";
import { assembleLearningTasks } from "../../../../apps/backend/src/modules/product-tasks/index.js";
import { assembleSubmissionReview } from "../../../../apps/backend/src/modules/product-tasks/facets/submission-review/submission-review.js";
import { taskDefinitionDigest } from "../../../../apps/backend/src/modules/product-tasks/domain/task-definition.js";
import { startLocalStand } from "../local-stand.mjs";
import { refusingLearnerMcpDependencies } from "../../../../apps/backend/test/fixtures/learner-mcp.js";
import { docker, assertNoLabResources } from "./process.mjs";
import type { ChapterSnapshot } from "./contracts.mjs";

export const labPostgresImage =
  "ghcr.io/sachkov-inside/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
export const learnerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Disposable real schema and capability composition, synthetic identity, no shared stand. */
export async function startChapterStand(
  snapshot: ChapterSnapshot,
  runId: string,
  signal: AbortSignal,
) {
  const name = `inside-chapter-lab-db-${runId}`;
  let prisma: ReturnType<typeof createPrismaClient> | undefined;
  let stand: Awaited<ReturnType<typeof startLocalStand>> | undefined;
  const close = async () => {
    try {
      await stand?.close();
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        await docker(["rm", "-f", name], { acceptFailure: true });
        await assertNoLabResources(runId);
      }
    }
  };
  try {
    await docker(
      [
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        "--label",
        `inside.chapter-lab=${runId}`,
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--tmpfs",
        "/var/lib/postgresql:rw,size=512m",
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "-e",
        "POSTGRES_DB=chapter_lab",
        "-p",
        "127.0.0.1::5432",
        labPostgresImage,
      ],
      { signal },
    );
    const deadline = performance.now() + 60_000;
    for (;;) {
      try {
        await docker(
          [
            "exec",
            name,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
            "-d",
            "chapter_lab",
          ],
          { signal, timeoutMs: 5000 },
        );
        break;
      } catch (error) {
        if (signal.aborted || performance.now() > deadline) throw error;
      }
    }
    const port = (await docker(["port", name, "5432/tcp"])).stdout
      .trim()
      .split(":")
      .at(-1);
    if (port === undefined) throw Error("Database port missing");
    const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/chapter_lab`;
    await migrateToLatest(databaseUrl);
    prisma = createPrismaClient(databaseUrl);
    const db = prisma;
    const owner = randomUUID();
    for (const id of [
      owner,
      learnerId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]) {
      await db.account.create({
        data: {
          id,
          logtoIssuer: "https://chapter-lab.invalid",
          logtoSubject: id,
        },
      });
    }
    const productId = randomUUID(),
      chapterId = randomUUID();
    await db.product.create({
      data: { id: productId, slug: "chapter-one-lab", name: "Chapter one lab" },
    });
    await db.productChapter.create({
      data: { id: chapterId, productId, name: "Глава 1", ordinal: 1 },
    });
    for (const [index, task] of snapshot.tasks.entries()) {
      const taskId = randomUUID(),
        now = new Date();
      await db.productTask.create({
        data: {
          id: taskId,
          code: task.code,
          sourceId: `inside-content:${task.code}`,
          productId,
          chapterId,
          position: index + 1,
          title: task.title,
          access: "free",
          relatedMaterialSourceIds: [],
          publicationState: "published",
          currentVersion: 1,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          versions: {
            create: {
              version: 1,
              definition: task.definition,
              definitionDigest: taskDefinitionDigest(task.definition),
              createdAt: now,
              sourceRepository: snapshot.repository,
              sourceCommit: snapshot.commit,
              sourcePath: task.path,
            },
          },
        },
      });
    }
    const authorPolicy = {
      canManage: (id: string) => Promise.resolve(id === owner),
    };
    const materials = assembleMaterials({ prisma: db, authorPolicy });
    const directory = new ProductDirectory(db);
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      productTaskResourceFacts: assembleProductTaskResourceFacts(db),
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      accountRights: assembleAccountRights({ prisma: db }),
    });
    const tasks = assembleLearningTasks({
      prisma: db,
      directory,
      contentAccess,
      submissionsEnabled: true,
    });
    const review = assembleSubmissionReview({
      prisma: db,
      directory,
      authorPolicy,
      identities: new TelegramAccountLinks(db),
      names: new MemberNames(db),
    });
    stand = await startLocalStand({
      ...refusingLearnerMcpDependencies(),
      contentAccess,
      tasks,
    });
    const nativeStand = stand;
    const registered = z.object({ client_id: z.string() }).parse(
      await (
        await fetch(`${nativeStand.auth.issuer}/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            redirect_uris: ["http://127.0.0.1/callback"],
          }),
        })
      ).json(),
    );
    async function learnerToken() {
      const verifier = randomUUID();
      const authorize = new URL(`${nativeStand.auth.issuer}/authorize`);
      authorize.search = new URLSearchParams({
        client_id: registered.client_id,
        redirect_uri: "http://127.0.0.1/callback",
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        resource: nativeStand.serverUrl,
      }).toString();
      const authorization = await fetch(authorize, { redirect: "manual" });
      const code = new URL(
        authorization.headers.get("location") ?? "",
      ).searchParams.get("code");
      if (code === null) throw Error("Synthetic authorization failed");
      const token = await fetch(`${nativeStand.auth.issuer}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registered.client_id,
          redirect_uri: "http://127.0.0.1/callback",
          code,
          code_verifier: verifier,
        }),
      });
      return z.object({ access_token: z.string() }).parse(await token.json())
        .access_token;
    }
    return {
      tasks,
      review,
      owner,
      prisma: db,
      subject: { kind: "account" as const, accountId: accountId(learnerId) },
      serverUrl: nativeStand.serverUrl,
      learnerToken,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
