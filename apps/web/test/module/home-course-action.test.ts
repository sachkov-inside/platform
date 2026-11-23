import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { learningScenario as facts } from "../../../../scenarios/learning.mjs";
import { commerceScenario } from "../../../../scenarios/commerce.mjs";
import { realBffSession } from "../support/real-bff-session";
import {
  readHomeCourseAction,
  readHomeCourseDiscount,
} from "@/_pages/home/api/home-course-action.server";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const productId = facts.product.id;
const slug = facts.product.slug;
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;
let access: "open" | "closed" | "unknown";
let continuationSlug: string | null;
let continuationUnavailable: boolean;
let offersUnavailable: boolean;
let promotion: Record<string, unknown> | null;
let waitlistAvailable: boolean;
let unexpected: string[];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(facts.fixtureDate));
  session = await realBffSession();
  backend.mockReset();
  access = "open";
  continuationSlug = null;
  continuationUnavailable = false;
  offersUnavailable = false;
  promotion = null;
  waitlistAvailable = false;
  unexpected = [];
  backend.mockImplementation((request) => {
    const url = new URL(request.url);
    const page = { items: [], nextCursor: null };
    let response: Response;
    switch (url.pathname) {
      case `/accounts/current/products/${productId}/access`:
        response =
          access === "unknown"
            ? new Response(null, { status: 503 })
            : Response.json({ access });
        break;
      case "/billing/product-prices":
        response = offersUnavailable
          ? new Response(null, { status: 503 })
          : Response.json(
              promotion === null
                ? page
                : {
                    items: [
                      {
                        ...productWithSupportOffer,
                        product: {
                          id: productId,
                          name: facts.product.name,
                          priceRevision: 1,
                        },
                        promotion,
                      },
                    ],
                    nextCursor: null,
                  },
            );
        break;
      case "/billing/product-sales-states":
        response = Response.json(page);
        break;
      case `/product-waitlists/${productId}/membership`:
      case `/product-waitlists/${productId}/intake`:
        response = waitlistAvailable
          ? Response.json({
              intakeId: commerceScenario.waitlist.intakeId,
              name: commerceScenario.waitlist.name,
              active: false,
            })
          : new Response(null, { status: 404 });
        break;
      case "/accounts/current/billing":
        response = new Response(null, { status: 503 });
        break;
      case `/reading-activity/product-continuation/${slug}`:
        response = continuationUnavailable
          ? new Response(null, { status: 503 })
          : Response.json({
              collection: {
                id: productId,
                slug,
                name: facts.product.name,
                summary: facts.product.summary,
                cover: null,
                count: 4,
                previewItems: [],
              },
              read: 0,
              total: 4,
              continuation:
                continuationSlug === null
                  ? null
                  : {
                      materialSlug: continuationSlug,
                      resume: { kind: "start" },
                    },
            });
        break;
      default:
        unexpected.push(request.url);
        response = new Response(null, { status: 500 });
    }
    return Promise.resolve(response);
  });
  vi.stubGlobal("fetch", backend);
});
afterEach(() => {
  vi.useRealTimers();
  expect(unexpected).toEqual([]);
});
const read = () => session(() => readHomeCourseAction(productId, slug));

it("opens the programme before the participant visits a lesson", async () => {
  expect(await read()).toEqual({
    kind: "programme",
    href: "/products/synthetic-learning/programme",
    label: "Открыть программу",
  });
});
it("continues the participant's learning from the common reader state", async () => {
  continuationSlug = "synthetic-intro";
  expect(await read()).toMatchObject({ label: "Продолжить обучение" });
  for (const path of [
    "/accounts/current/products/97000000-0000-4000-8000-000000000001/access",
    "/reading-activity/product-continuation/synthetic-learning",
  ]) {
    const request = backend.mock.calls
      .map(([request]) => request)
      .find((request) => new URL(request.url).pathname === path);
    expect(request?.method).toBe("GET");
    expect(request?.headers.get("authorization")).toBe("Bearer trusted-token");
  }
});
it("keeps public course entry for guest, closed, unknown and unavailable reader states", async () => {
  session = await realBffSession(null);
  expect(await read()).toBeNull();
  session = await realBffSession();
  access = "closed";
  expect(await read()).toBeNull();
  waitlistAvailable = true;
  expect(await read()).toBeNull();
  access = "unknown";
  expect(await read()).toBeNull();
  access = "closed";
  offersUnavailable = true;
  expect(await read()).toBeNull();
});

it("opens the programme when personal learning continuation is unavailable", async () => {
  continuationUnavailable = true;
  expect(await read()).toMatchObject({ label: "Открыть программу" });
});

const blackFriday = {
  id: "00000000-0000-4000-8000-000000000901",
  revision: 1,
  name: "Чёрная пятница",
  percent: 25,
  endsAt: "2026-11-30T21:00:00.000Z",
};
const readDiscount = () =>
  session(() => readHomeCourseDiscount(productId, slug));

it("names the running discount to a guest and to an account without the course", async () => {
  promotion = blackFriday;
  session = await realBffSession(null);
  expect(await readDiscount()).toEqual({
    percent: "−25\u00a0%",
    amount: "25\u00a0%",
    name: "Чёрная пятница",
    until: "до 30 ноября",
  });
  session = await realBffSession();
  access = "closed";
  expect(await readDiscount()).toMatchObject({ percent: "−25\u00a0%" });
});
it("shows no discount to a participant, without a Promotion or without prices", async () => {
  promotion = blackFriday;
  expect(await readDiscount()).toBeNull();
  access = "closed";
  promotion = null;
  expect(await readDiscount()).toBeNull();
  promotion = blackFriday;
  offersUnavailable = true;
  expect(await readDiscount()).toBeNull();
});
