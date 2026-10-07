// @ts-check
// Isolated full-stack seed through real author APIs; never used by production or the shared stand.
import { z } from "zod";
import { convertMarkdown } from "../tools/authoring/markdown.mjs";
const receipt = z.object({ materialId: z.uuid(), contentVersion: z.number() });

/** @param {string} origin @param {string} accessToken @param {"free" | "closed"} [access] */
export async function seedFullStackPractice(
  origin,
  accessToken,
  access = "closed",
) {
  const practiceId = `synthetic:fullstack-practice${access === "free" ? "-free" : ""}`;
  /** @param {string} path @param {unknown} [body] */
  const request = async (path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": `fullstack-practice-${access}-${path}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Synthetic practice seed ${path}: HTTP ${response.status}; ${JSON.stringify(await response.json())}`,
      );
    return /** @type {unknown} */ (await response.json());
  };
  const source = {
    id: practiceId,
    path: "practice.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const product = z.object({ id: z.uuid() }).parse(
    await request("/authoring/import/products/reserve", {
      sourceId: "synthetic:fullstack-practice-product",
      name: "Synthetic practice",
      slug: "synthetic-practice",
      summary: "Isolated imported practice fixture",
    }),
  );
  const reserved = receipt.parse(
    await request("/authoring/import/materials/reserve", { source }),
  );
  const saved = receipt.parse(
    await request("/authoring/import/materials/apply", {
      source,
      materialId: reserved.materialId,
      expectedContentVersion: reserved.contentVersion,
      publicationState: "published",
      primaryVideoId: null,
      metadata: {
        title: `Synthetic practice reference ${access}`,
        summary: "Isolated Reader and authorization fixture",
        access,
        topicId: "72000000-0000-4000-8000-000000000002",
        formatId: "guide",
        tagIds: [],
        seriesIds: [product.id],
        difficulty: null,
        outcomes: [],
      },
      body: convertMarkdown(
        "FULLSTACK_PRIVATE_PRACTICE_BODY: business requests, state, duplicates and ownership.",
        {
          sourceId: source.id,
          sourcePath: source.path,
          link: (href) => href,
          image: (href) => href,
        },
      ),
    }),
  );
  await request("/authoring/import/practices/apply", {
    practiceId,
    materialId: saved.materialId,
    expectedContentVersion: saved.contentVersion,
    expectedPracticeVersion: null,
    publicationState: "published",
    sourceReference: {
      materialSourceId: source.id,
      materialSourceRevision: source.revision,
    },
    provenance: {
      repository: "synthetic/fullstack",
      commit: "b".repeat(40),
      path: "practice.json",
    },
    definition: {
      schemaVersion: 1,
      title: "Бриф консультаций",
      businessInputs: "Участник видит только свою заявку.",
      expectedOutcome: "Самостоятельный бриф.",
      allowedFreedom: "Любой формат документа.",
      criteria: [
        {
          id: "ownership",
          requirement: "Чужая заявка не раскрывается.",
          acceptableEvidence: ["Явное бизнес-ограничение."],
        },
      ],
    },
  });
  const material = z
    .object({ metadata: z.object({ slug: z.string() }) })
    .parse(await request(`/authoring/materials/${saved.materialId}`));
  return {
    materialId: saved.materialId,
    slug: material.metadata.slug,
    practiceId,
  };
}

/** A disposable stand-only proxy delays the real practice response to exercise Reader readiness.
 * @param {string} upstream @param {number} delayMs */
export async function startPracticeReadProxy(upstream, delayMs) {
  const { createServer, request } = await import("node:http");
  const { setTimeout: delay } = await import("node:timers/promises");
  const proxy = createServer((incoming, outgoing) => {
    void (async () => {
      if (incoming.url?.endsWith("/practices") === true) await delay(delayMs);
      const forwarded = request(
        new URL(incoming.url ?? "/", upstream),
        {
          method: incoming.method,
          headers: { ...incoming.headers, host: new URL(upstream).host },
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      forwarded.on("error", () => outgoing.writeHead(502).end());
      incoming.pipe(forwarded);
    })().catch(() => outgoing.writeHead(502).end());
  });
  await new Promise((resolve) =>
    proxy.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  const address = proxy.address();
  if (address === null || typeof address === "string")
    throw new Error("No practice proxy port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve(undefined))),
      ),
  };
}
