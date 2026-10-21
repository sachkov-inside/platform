import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ProductSale } from "@/entities/subscription.sale.server";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const fakes = vi.hoisted(() => ({
  access: vi.fn(),
  sale: vi.fn(),
  token: vi.fn(() => Promise.resolve("synthetic-viewer-token")),
}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("@/entities/subscription.sale.server", () => ({
  readProductAccess: fakes.access,
  readGuestProductSale: fakes.sale,
  readViewerProductSale: fakes.sale,
}));
vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: fakes.token,
}));
vi.mock("@/features/reading-progress.server", () => ({
  getSeriesContinuation: () =>
    Promise.resolve({
      kind: "ready",
      continuation: { materialSlug: "introduction" },
    }),
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
  PublishedSeriesResult,
  { readonly kind: "ready" | "empty" }
> = {
  kind: "empty",
  discoveryKind: "series",
  chapters: [],
  relatedSeries: [],
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
async function compose(access: "open" | "closed", active: boolean) {
  fakes.access.mockResolvedValue(access);
  fakes.sale.mockResolvedValue({ ...sale, access });
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
  expect(html).toContain("aie-learning-status");
});
test("learners can continue from the film without loading a sale or cohort", async () => {
  fakes.access.mockResolvedValue("open");
  const html = renderToStaticMarkup(
    await PersonalCourseFilmOverlay({ result }),
  );
  expect(html).toContain("aie-learning-film");
  expect(html).toContain("Продолжить обучение");
  expect(html).toContain("/products/ai-engineering/programme");
  expect(fakes.sale).not.toHaveBeenCalled();
});
test("an inactive learner keeps learning without a new join CTA", async () => {
  const html = await compose("open", false);
  expect(html).toContain("Продолжить обучение");
  expect(html).not.toContain("Отказаться от ожидания");
  expect(html).not.toContain("Вступить в список ожидания");
});
