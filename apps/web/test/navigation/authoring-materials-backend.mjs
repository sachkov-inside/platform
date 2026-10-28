// @ts-check
import { z } from "zod";

/**
 * The authoring Materials list of the navigation suite: an isolated HTTP fixture in the shape of
 * the Nest contract, not a permission test. Tokens select authored outcomes; permission, filtering
 * and ordering rules are proven by the backend integration tests.
 */

const authoringMaterialTopics = Object.freeze({
  agents: {
    id: "97000000-0000-4000-8000-000000000101",
    name: "Разработка с агентами",
  },
  ai: { id: "97000000-0000-4000-8000-000000000102", name: "AI Engineering" },
  archived: {
    id: "97000000-0000-4000-8000-000000000103",
    name: "Тестирование",
  },
});
const formatNames = /** @type {const} */ ({
  guide: "Гайд",
  note: "Заметка",
  video: "Видео",
});
const pageSize = 20;

/**
 * @typedef {{
 *   materialId: string,
 *   title: string,
 *   topic: { id: string, name: string },
 *   format: keyof typeof formatNames,
 *   publicationState: "draft" | "published" | "unpublished",
 *   contentVersion: number,
 *   neverPublished: boolean,
 *   updatedAt: string,
 * }} FixtureMaterial
 */

/** @returns {FixtureMaterial[]} */
function initialMaterials() {
  /** @type {FixtureMaterial[]} */
  const named = [
    {
      materialId: "97000000-0000-4000-8000-000000000001",
      title: "Ревью кода с агентом",
      topic: authoringMaterialTopics.agents,
      format: "video",
      publicationState: "unpublished",
      contentVersion: 3,
      neverPublished: false,
      updatedAt: "2026-10-20T09:00:00.000Z",
    },
    {
      materialId: "97000000-0000-4000-8000-000000000002",
      title: "Субагенты",
      topic: authoringMaterialTopics.agents,
      format: "guide",
      publicationState: "draft",
      contentVersion: 1,
      neverPublished: true,
      updatedAt: "2026-10-19T09:00:00.000Z",
    },
  ];
  const generated = Array.from({ length: 22 }, (_, index) => ({
    materialId: `97000000-0000-4000-8000-${String(index + 11).padStart(12, "0")}`,
    title: `Практика инженера ${String(index + 1).padStart(2, "0")}`,
    topic:
      index % 3 === 2
        ? authoringMaterialTopics.archived
        : authoringMaterialTopics.ai,
    format:
      /** @type {const} */ (["guide", "note", "video"])[index % 3] ?? "guide",
    publicationState: /** @type {const} */ ("published"),
    contentVersion: 2,
    neverPublished: false,
    updatedAt: new Date(
      Date.parse("2026-10-18T09:00:00.000Z") - index * 3_600_000,
    ).toISOString(),
  }));
  return [...named, ...generated];
}

let materials = initialMaterials();

const publicationSchema = z
  .object({
    expectedContentVersion: z.number().int().positive(),
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();

/** @param {number} status @param {string} code */
function problem(status, code) {
  return {
    status,
    value: { code, status, title: code, type: `urn:inside:problem:${code}` },
  };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function authoringMaterialsRoute(request, url, readBody) {
  if (url.pathname === "/__authoring-materials/reset") {
    materials = initialMaterials();
    return { status: 200, value: { reset: true } };
  }
  const publication = /^\/authoring\/materials\/([^/]+)\/publication$/u.exec(
    url.pathname,
  );
  const isList = url.pathname === "/authoring/materials";
  const isReferences = url.pathname === "/authoring/materials/references";
  // A row click opens the editor; this suite does not serve it, so it reads as a missing Material.
  const isEditorRead =
    request.method === "GET" &&
    !isReferences &&
    /^\/authoring\/materials\/[^/]+$/u.test(url.pathname);
  if (isEditorRead) return problem(404, "material_not_found");
  if (!isList && !isReferences && publication === null) return null;

  const token = request.headers.authorization;
  if (token === undefined) return problem(401, "invalid_proof");
  if (token === "Bearer materials-forbidden") return problem(403, "forbidden");
  if (token === "Bearer materials-unavailable")
    return problem(503, "dependency_unavailable");

  if (isReferences && request.method === "GET")
    return {
      status: 200,
      value: {
        formats: Object.entries(formatNames).map(([id, name]) => ({
          archived: false,
          id,
          name,
        })),
        products: [],
        tags: [],
        topics: [
          { ...authoringMaterialTopics.ai, archived: false },
          { ...authoringMaterialTopics.agents, archived: false },
          { ...authoringMaterialTopics.archived, archived: true },
        ],
      },
    };

  if (publication !== null && request.method === "PATCH") {
    const material = materials.find(
      (candidate) => candidate.materialId === publication[1],
    );
    if (material === undefined) return problem(404, "material_not_found");
    const input = publicationSchema.parse(JSON.parse(await readBody(request)));
    if (input.expectedContentVersion !== material.contentVersion)
      return {
        status: 409,
        value: {
          ...problem(409, "stale_content_version").value,
          currentContentVersion: material.contentVersion,
        },
      };
    material.publicationState = input.publicationState;
    material.contentVersion += 1;
    material.neverPublished = false;
    return {
      status: 200,
      value: {
        contentVersion: material.contentVersion,
        materialId: material.materialId,
        publicationState: material.publicationState,
        publishedAt:
          material.publicationState === "published"
            ? "2026-10-24T09:00:00.000Z"
            : null,
      },
    };
  }

  if (!isList || request.method !== "GET") return null;
  const search = url.searchParams.get("search")?.toLocaleLowerCase("ru");
  const state = url.searchParams.get("publicationState");
  const topicId = url.searchParams.get("topicId");
  const format = url.searchParams.get("format");
  const page = Number(url.searchParams.get("page") ?? "1");
  const rows = materials
    .filter(
      (material) =>
        (search === undefined ||
          material.title.toLocaleLowerCase("ru").includes(search)) &&
        (state === null || material.publicationState === state) &&
        (topicId === null || material.topic.id === topicId) &&
        (format === null || material.format === format),
    )
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.materialId.localeCompare(right.materialId),
    );
  return {
    status: 200,
    value: {
      items: rows
        .slice((page - 1) * pageSize, page * pageSize)
        .map((material) => ({
          canDelete: material.neverPublished,
          contentVersion: material.contentVersion,
          format: { id: material.format, name: formatNames[material.format] },
          materialId: material.materialId,
          publicationState: material.publicationState,
          title: material.title,
          topic: material.topic,
          updatedAt: material.updatedAt,
        })),
      page,
      pageSize,
      totalItems: rows.length,
      totalPages: Math.ceil(rows.length / pageSize),
    },
  };
}
