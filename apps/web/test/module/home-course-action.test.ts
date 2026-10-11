import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  access: vi.fn(),
  continuation: vi.fn(),
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: { accessToken: fakes.token },
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestProductAccess: fakes.access,
  requestSeriesContinuation: fakes.continuation,
}));

import { readHomeCourseAction } from "@/_pages/home/api/home-course-action.server";
import { LogtoSessionUnavailableError } from "@/shared/auth/session-adapter.server";

const productId = "00000000-0000-4000-8000-000000000814";
const slug = "ai-engineering";
const response = (body: unknown) => ({
  ok: true,
  body,
  response: new Response(),
});
const continuation = (materialSlug: string | null) =>
  response({
    collection: {
      id: productId,
      name: "AI Engineering",
      slug,
      summary: null,
      cover: null,
      count: 2,
      previewItems: [],
    },
    read: 0,
    total: 2,
    continuation:
      materialSlug === null
        ? null
        : { materialSlug, resume: { kind: "start" } },
  });

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("viewer-token");
  fakes.access.mockResolvedValue(response({ access: "open" }));
  fakes.continuation.mockResolvedValue(continuation(null));
});

it("opens the programme before the participant visits a lesson", async () => {
  expect(await readHomeCourseAction(productId, slug)).toEqual({
    kind: "programme",
    href: "/products/ai-engineering/programme",
    label: "Открыть программу",
  });
});

it("continues the participant's last lesson with programme return context", async () => {
  fakes.continuation.mockResolvedValue(continuation("course-intro"));
  expect(await readHomeCourseAction(productId, slug)).toEqual({
    kind: "programme",
    href: "/materials/course-intro?from=%2Fproducts%2Fai-engineering%2Fprogramme",
    label: "Продолжить обучение",
  });
  expect(fakes.access).toHaveBeenCalledWith(productId, "viewer-token");
  expect(fakes.continuation).toHaveBeenCalledWith(slug, "viewer-token");
});

it("keeps the public course entry for guests and people without proven access", async () => {
  fakes.token.mockRejectedValueOnce(new LogtoSessionUnavailableError());
  expect(await readHomeCourseAction(productId, slug)).toBeNull();
  for (const access of [
    response({ access: "closed" }),
    response({ access: "invalid" }),
    { ok: false, response: new Response(null, { status: 503 }) },
  ]) {
    fakes.access.mockResolvedValue(access);
    expect(await readHomeCourseAction(productId, slug)).toBeNull();
  }
  expect(fakes.continuation).not.toHaveBeenCalled();
});

it("still opens the programme when continuation is unavailable or already complete", async () => {
  fakes.continuation.mockRejectedValueOnce(new Error("unavailable"));
  expect(await readHomeCourseAction(productId, slug)).toMatchObject({
    label: "Открыть программу",
  });
  fakes.continuation.mockResolvedValue(
    response({
      collection: {
        id: productId,
        name: "AI Engineering",
        slug,
        summary: null,
        cover: null,
        count: 2,
        previewItems: [],
      },
      read: 2,
      total: 2,
      continuation: null,
    }),
  );
  expect(await readHomeCourseAction(productId, slug)).toMatchObject({
    label: "Открыть программу",
  });
});
