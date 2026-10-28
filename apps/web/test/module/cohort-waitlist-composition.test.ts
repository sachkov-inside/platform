import { createElement, Fragment } from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ProductSale } from "@/entities/subscription.sale.server";
import type { PublishedProductResult } from "@/features/library-discovery";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const fakes = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("@/widgets/product-reader-state/index.server", () => ({
  readProductReaderState: fakes.state,
}));
vi.mock("@/entities/material", () => ({
  useMaterialReading: () => ({ accountId: "viewer-account", resolved: true }),
}));
vi.mock("@/features/account-access", () => ({
  TelegramLinkAction: () => null,
}));

import {
  PersonalCohortCall,
  PersonalCohortStatus,
  PersonalCourseFilmOverlay,
} from "@/_pages/library-discovery/ui/cohort-call.server";
import { WaitlistProvider } from "@/_pages/library-discovery/ui/waitlist-provider.client";
import { productWaitlistKey } from "@/features/product-waitlist";

const productId = "10000000-0000-4000-8000-000000001568";
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
const sale: ProductSale = {
  kind: "ready",
  sold: true,
  signedIn: true,
  access: "closed",
  offers: [productWithSupportOffer],
  cohortKnown: true,
  terms: null,
  cohort: {
    productId,
    revision: 1,
    name: "Следующий поток",
    stage: "preorder",
    startsOn: "2030-04-01",
    nextEvent: "",
    priceAfterStartKopecks: null,
  },
};
function readerState(access: "open" | "closed") {
  const common = {
    productId,
    slug: "ai-engineering",
    access,
    signedIn: true,
    sale: { ...sale, access },
    waitlist: {
      kind: "ready",
      intakeId: "explicit-intake",
      name: "Следующий набор",
      active: true,
    },
  };
  return access === "open"
    ? {
        ...common,
        kind: "learning",
        continuation: {
          kind: "ready",
          continuation: { materialSlug: "introduction" },
        },
        onboarding: Promise.resolve({ kind: "none" }),
        presentation: Promise.resolve({
          sale: common.sale,
          waitlist: common.waitlist,
        }),
      }
    : { ...common, kind: "sale" };
}
async function compose(access: "open" | "closed", active: boolean) {
  fakes.state.mockResolvedValue(readerState(access));
  const cache = new QueryClient();
  cache.setQueryData(productWaitlistKey("viewer-account", productId), {
    kind: "ready",
    intakeId: "explicit-intake",
    name: "Следующий набор",
    active,
    accountId: "viewer-account",
    continuation: false,
  });
  try {
    const [hero, lower] = await Promise.all([
      PersonalCohortCall({ result }),
      PersonalCohortStatus({ result }),
    ]);
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(WaitlistProvider, {
          productId,
          productSlug: "ai-engineering",
          children: createElement(Fragment, null, hero, lower),
        }),
      ),
    );
  } finally {
    cache.clear();
  }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  fakes.state.mockResolvedValue(readerState("open"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("active membership shows confirmation without withdrawal beside a newly available purchase", async () => {
  const html = await compose("closed", true);
  expect(html).toContain("/products/ai-engineering/buy");
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
  fakes.state.mockResolvedValue(readerState("open"));
  const stream = await renderToReadableStream(
    await PersonalCourseFilmOverlay({ result }),
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("aie-learning-film");
  expect(html).toContain("Продолжить обучение");
  expect(html).toContain("/products/ai-engineering/programme");
  expect(html).toContain("до старта");
  expect(html).toContain("start-countdown-badge");
  expect(fakes.state).toHaveBeenCalledWith(productId, "ai-engineering");
});
test("an inactive learner keeps learning without a new join CTA", async () => {
  const html = await compose("open", false);
  expect(html).toContain("Продолжить обучение");
  expect(html).not.toContain("Отказаться от ожидания");
  expect(html).not.toContain("Вступить в список ожидания");
});
