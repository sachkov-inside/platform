import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  glossary: vi.fn(),
  BackendConnectionError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  BackendConnectionError: fakes.BackendConnectionError,
  requestCourseGlossary: fakes.glossary,
}));

import { loadCourseGlossary } from "@/_pages/course-glossary/api/load-course-glossary.server";

const body = {
  product: { slug: "ddd", name: "DDD" },
  terms: [
    {
      id: "bounded-context",
      title: "Ограниченный контекст",
      englishTitle: "Bounded context",
      shortDefinition: "Граница одного смысла слов модели.",
      fullDefinition: "Часть системы со своей моделью.",
      lesson: { slug: "ddd-intro", title: "Введение" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

it("reads the course Glossary as the signed-in reader", async () => {
  fakes.glossary.mockResolvedValue({
    ok: true,
    body,
    response: new Response(),
  });
  expect(await loadCourseGlossary("ddd", "reader-token")).toEqual({
    kind: "ready",
    ...body,
  });
  expect(fakes.glossary).toHaveBeenCalledWith("ddd", {
    accessToken: "reader-token",
  });
});

it("reads it as a guest without a token", async () => {
  fakes.glossary.mockResolvedValue({
    ok: true,
    body: { ...body, terms: [] },
    response: new Response(),
  });
  expect(await loadCourseGlossary("ddd", undefined)).toMatchObject({
    kind: "ready",
    terms: [],
  });
  expect(fakes.glossary).toHaveBeenCalledWith("ddd", {});
});

it("tells an unknown course from a failed backend", async () => {
  fakes.glossary.mockResolvedValueOnce({
    ok: false,
    problem: null,
    response: new Response(null, { status: 404 }),
  });
  expect(await loadCourseGlossary("missing", undefined)).toEqual({
    kind: "not-found",
  });
  fakes.glossary.mockResolvedValueOnce({
    ok: false,
    problem: null,
    response: new Response(null, { status: 503 }),
  });
  expect(await loadCourseGlossary("ddd", undefined)).toEqual({
    kind: "unavailable",
  });
  fakes.glossary.mockResolvedValueOnce({
    ok: true,
    body: { product: body.product },
    response: new Response(),
  });
  expect(await loadCourseGlossary("ddd", undefined)).toEqual({
    kind: "unavailable",
  });
});
