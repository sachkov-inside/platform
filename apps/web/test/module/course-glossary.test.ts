import { beforeEach, expect, it, vi } from "vitest";

import { learningScenario as facts } from "../../../../scenarios/learning.mjs";
const backend = vi.fn<(request: Request) => Promise<Response>>();

import { loadCourseGlossary } from "@/_pages/course-glossary/api/load-course-glossary.server";

const lesson = facts.lessons.find(
  (candidate) => candidate.key === facts.glossary.introducedIn,
);
if (lesson === undefined) throw new Error("Missing canonical glossary lesson");
const body = {
  product: { slug: facts.product.slug, name: facts.product.name },
  terms: [
    {
      id: facts.glossary.id,
      title: facts.glossary.title,
      englishTitle: facts.glossary.englishTitle,
      shortDefinition: facts.glossary.shortDefinition,
      fullDefinition: facts.glossary.fullDefinition,
      lesson: { slug: lesson.slug, title: lesson.title },
    },
  ],
};

beforeEach(() => {
  backend.mockReset();
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  vi.stubGlobal("fetch", backend);
});

it("reads the course Glossary as the signed-in reader", async () => {
  backend.mockResolvedValueOnce(Response.json(body));
  expect(await loadCourseGlossary(facts.product.slug, "reader-token")).toEqual({
    kind: "ready",
    ...body,
  });
  const sent = expectBackendRequest();
  expect(sent.headers.get("authorization")).toBe("Bearer reader-token");
});

it("reads it as a guest without a token", async () => {
  backend.mockResolvedValueOnce(Response.json({ ...body, terms: [] }));
  expect(await loadCourseGlossary(facts.product.slug, undefined)).toMatchObject(
    {
      kind: "ready",
      terms: [],
    },
  );
  expect(expectBackendRequest().headers.has("authorization")).toBe(false);
});

it("tells an unknown course from a failed backend", async () => {
  backend.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await loadCourseGlossary("missing", undefined)).toEqual({
    kind: "not-found",
  });
  backend.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await loadCourseGlossary(facts.product.slug, undefined)).toEqual({
    kind: "unavailable",
  });
  backend.mockResolvedValueOnce(Response.json({ product: body.product }));
  expect(await loadCourseGlossary(facts.product.slug, undefined)).toEqual({
    kind: "unavailable",
  });
});

function expectBackendRequest(): Request {
  expect(backend).toHaveBeenCalledOnce();
  const request = backend.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe("GET");
  expect(request.url).toBe(
    "https://platform-api.example.test/library/products/synthetic-learning/glossary",
  );
  return request;
}
