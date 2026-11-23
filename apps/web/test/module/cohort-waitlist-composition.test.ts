import { createElement, Fragment } from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";
import { ReadingProgressProvider } from "@/features/reading-progress/ui/reading-provider.client";
import {
  commerceScenario,
  commerceFixtureFacts,
} from "../../../../scenarios/commerce.mjs";
import type { PublishedProductResult } from "@/features/library-discovery";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

import {
  PersonalCohortCall,
  PersonalCohortStatus,
  PersonalCourseFilmOverlay,
} from "@/_pages/library-discovery/ui/cohort-call.server";
import { WaitlistProvider } from "@/_pages/library-discovery/ui/waitlist-provider.client";
import { productWaitlistKey } from "@/features/product-waitlist";

const offerProduct = productWithSupportOffer.product;
if (offerProduct === undefined)
  throw new Error("Expected existing product offer fixture");
const productId = offerProduct.id;
const accountId = commerceFixtureFacts.buyerAccountId;
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
let currentAccess: "open" | "closed";
let unexpected: string[];
const result: Extract<
  PublishedProductResult,
  { readonly kind: "ready" | "empty" }
> = {
  kind: "empty",
  discoveryKind: "product",
  chapters: [],
  relatedProduct: [],
  topics: [],
  reference: {
    id: productId,
    slug: "ai-engineering",
    name: "AI Engineering",
    summary: "",
  },
};
async function compose(access: "open" | "closed", active: boolean) {
  currentAccess = access;
  const cache = new QueryClient();
  cache.setQueryData(productWaitlistKey(accountId, productId), {
    kind: "ready",
    intakeId: commerceScenario.waitlist.intakeId,
    name: commerceScenario.waitlist.name,
    active,
    accountId,
    continuation: false,
  });
  try {
    const [hero, lower] = await Promise.all([
      scope(() => PersonalCohortCall({ result })),
      scope(() => PersonalCohortStatus({ result })),
    ]);
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(ReadingProgressProvider, {
          accountId,
          resolved: true,
          children: createElement(WaitlistProvider, {
            productId,
            productSlug: "ai-engineering",
            children: createElement(Fragment, null, hero, lower),
          }),
        }),
      ),
    );
  } finally {
    cache.clear();
  }
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  scope = await realBffSession();
  currentAccess = "open";
  unexpected = [];
  backend.mockReset();
  backend.mockImplementation((request) => {
    const url = new URL(request.url);
    let response: Response;
    switch (url.pathname) {
      case `/accounts/current/products/${productId}/access`:
        response = Response.json({ access: currentAccess });
        break;
      case "/billing/product-prices":
        response = Response.json({
          items: [productWithSupportOffer],
          nextCursor: null,
        });
        break;
      case "/billing/product-sales-states":
        response = Response.json({
          items: [
            {
              productId,
              revision: 1,
              name: "Следующий поток",
              stage: "preorder",
              startsOn: "2030-04-01",
              nextEvent: "",
              priceAfterStartKopecks: null,
            },
          ],
          nextCursor: null,
        });
        break;
      case `/product-waitlists/${productId}/membership`:
        response = Response.json({
          intakeId: commerceScenario.waitlist.intakeId,
          name: commerceScenario.waitlist.name,
          active: true,
        });
        break;
      case "/accounts/current/billing":
        response = new Response(null, { status: 503 });
        break;
      case "/reading-activity/product-continuation/ai-engineering":
        response = Response.json({
          collection: {
            id: productId,
            slug: "ai-engineering",
            name: "AI Engineering",
            summary: "",
            cover: null,
            count: 1,
            previewItems: [],
          },
          read: 0,
          total: 1,
          continuation: {
            materialSlug: "introduction",
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
  interceptBackendHttp(backend);
});
afterEach(() => {
  vi.useRealTimers();
  expect(unexpected).toEqual([]);
  for (const [request] of backend.mock.calls) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).origin).toBe(
      "https://platform-api.example.test",
    );
    expect(request.headers.get("authorization")).toBe(
      new URL(request.url).pathname === "/billing/product-sales-states"
        ? null
        : "Bearer trusted-token",
    );
  }
});

test("active membership shows confirmation without withdrawal beside a newly available purchase", async () => {
  const html = await compose("closed", true);
  expect(html).toContain("/products/ai-engineering/buy");
  expect(html).toContain("Вы в списке ожидания");
  expect(html).not.toContain("Отказаться от ожидания");
  expect(html).not.toContain("Вступить в список ожидания");
});
test("active membership is hidden when learning is available", async () => {
  const html = await compose("open", true);
  expect(html).toContain("Продолжить обучение");
  expect(html).toContain("/products/ai-engineering/programme");
  expect(html).not.toContain("списке ожидания");
  expect(html).not.toContain("Отказаться от ожидания");
  expect(html).not.toContain("Вступить в список ожидания");
  expect(html).toContain("aie-status-learner");
  expect(html).not.toContain("aie-learning-status");
});
test("the film displays the same learning state and sales countdown", async () => {
  const stream = await renderToReadableStream(
    await scope(() => PersonalCourseFilmOverlay({ result })),
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("aie-learning-film");
  expect(html).toContain("Продолжить обучение");
  expect(html).toContain("/products/ai-engineering/programme");
  expect(html).toContain("до старта");
  expect(html).toContain("start-countdown-badge");
  const urls = backend.mock.calls.map(([request]) => request.url);
  expect(urls).toContain(
    "https://platform-api.example.test/accounts/current/products/00000000-0000-4000-8000-000000000f01/access",
  );
  expect(urls).toContain(
    "https://platform-api.example.test/reading-activity/product-continuation/ai-engineering",
  );
});
test("an inactive learner keeps learning without a new join CTA", async () => {
  const html = await compose("open", false);
  expect(html).toContain("Продолжить обучение");
  expect(html).not.toContain("Отказаться от ожидания");
  expect(html).not.toContain("Вступить в список ожидания");
});

test("the film links to the programme when no free lesson is confirmed", async () => {
  currentAccess = "closed";
  const stream = await renderToReadableStream(
    await scope(() => PersonalCourseFilmOverlay({ result })),
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("Посмотреть программу");
  expect(html).toContain("/products/ai-engineering/programme");
});
