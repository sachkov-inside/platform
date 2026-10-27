// @ts-check
import { z } from "zod";
const scenarios = [
  "guest",
  "paid",
  "manual",
  "stopped",
  "archive",
  "waitlist",
  "unknown",
];
/** @type {{path: string, authorized: boolean, status: number}[]} */
let reads = [];
/** @type {ReturnType<typeof fixture>} */
let pinned = null;
/** @type {Promise<void> | null} */
let optionalHold = null;
/** @type {(() => void) | null} */
let releaseOptional = null;
let abortedOptional = 0;
let optionalTarget = "all";
/** @type {Map<import("node:http").ServerResponse, string>} */
const blockedOptional = new Map();
/** Explicit response barrier, released by each owning test in finally. */
/** @param {boolean} hold @param {string} [target] */
export function holdReaderOptionalResponses(hold, target = "all") {
  releaseOptional?.();
  releaseOptional = null;
  optionalTarget = target;
  if (hold) abortedOptional = 0;
  optionalHold = hold
    ? new Promise((resolve) => {
        releaseOptional = resolve;
      })
    : null;
}
/** @param {URL} url @param {import("node:http").ServerResponse} response */
export async function waitReaderOptionalResponse(url, response) {
  if (
    url.pathname.startsWith("/billing/product-") ||
    url.pathname.startsWith("/product-waitlists/") ||
    url.pathname === "/accounts/current/billing" ||
    url.pathname.includes("community-entry")
  )
    if (
      optionalHold !== null &&
      (optionalTarget === "all" || url.pathname.includes("community-entry"))
    ) {
      const held = optionalHold;
      const onClose = () => {
        if (optionalHold === held) abortedOptional += 1;
      };
      response.once("close", onClose);
      blockedOptional.set(response, url.pathname);
      try {
        await held;
      } finally {
        response.off("close", onClose);
        blockedOptional.delete(response);
      }
    }
}
export function readerOptionalResponseState() {
  return {
    held: optionalHold !== null,
    aborted: abortedOptional,
    blocked: [...blockedOptional]
      .filter(([response]) => !response.destroyed)
      .map(([, path]) => path),
  };
}

const envelope = z.object({
  status: z.number(),
  value: z.record(z.string(), z.unknown()),
});
const productSchema = z
  .object({
    reference: z.record(z.string(), z.unknown()),
    items: z.array(z.unknown()),
  })
  .loose();
const pricesSchema = z.object({
  items: z.array(
    z
      .object({
        offer: z.record(z.string(), z.unknown()),
        paymentOption: z.record(z.string(), z.unknown()),
      })
      .loose(),
  ),
});
/** @param {string} slug */
function fixture(slug) {
  const match =
    /^reader-state-(guest|paid|manual|stopped|archive|waitlist|unknown)(-mobile)?$/u.exec(
      slug,
    );
  if (match === null) return null;
  const scenario = match[1] ?? "guest";
  const ordinal =
    scenarios.indexOf(scenario) + 1 + (match[2] === undefined ? 0 : 100);
  return {
    slug,
    scenario,
    id: `17100000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
  };
}
const fixtures = scenarios
  .flatMap((scenario) => [
    fixture(`reader-state-${scenario}`),
    fixture(`reader-state-${scenario}-mobile`),
  ])
  .filter((value) => value !== null);
/** Real HTTP fixture for the production server-only adapter, not a mock of its dependencies.
 * @param {import('node:http').IncomingMessage} request
 * @param {URL} url
 * @param {{baseRoute: (method: string | undefined, url: URL, entitled: boolean) => unknown}} owner
 * @returns {{status: number, value: unknown} | null}
 */
export function productReaderStateRoute(request, url, owner) {
  if (url.pathname === "/__product-reader-state") {
    if (request.method === "DELETE") reads = [];
    if (request.method === "POST")
      pinned = fixture(url.searchParams.get("pin") ?? "");
    return { status: 200, value: { reads } };
  }
  const token = request.headers.authorization?.replace(
    "Bearer reader-state:",
    "",
  );
  const byToken = token === undefined ? null : fixture(token);
  const bySlug = fixture(url.pathname.split("/").at(-1) ?? "");
  const queriedId = url.searchParams.get("productId");
  const byId =
    fixtures.find(
      (item) => item.id === queriedId || url.pathname.includes(item.id),
    ) ?? null;
  const selected =
    bySlug ??
    byId ??
    byToken ??
    (url.pathname === "/library/home" ? pinned : null);
  if (selected === null) return null;
  const signedIn =
    request.headers.authorization === `Bearer reader-state:${selected.slug}`;
  const holder =
    signedIn && ["paid", "manual", "archive"].includes(selected.scenario);
  /** @param {unknown} value @param {number} [status] */
  const reply = (value, status = 200) => {
    reads.push({
      path: url.pathname + url.search,
      authorized: signedIn,
      status,
    });
    return { status, value };
  };
  if (url.pathname === "/library/home" && pinned !== null) {
    const original = envelope.parse(owner.baseRoute("GET", url, false));
    const home = z
      .object({ pinnedProduct: z.record(z.string(), z.unknown()) })
      .loose()
      .parse(original.value);
    return reply({
      ...home,
      pinnedProduct: {
        ...home.pinnedProduct,
        id: pinned.id,
        slug: pinned.slug,
        name: `Reader state ${pinned.scenario}`,
        presentation: "ai-engineering-course",
        hero: { badge: "Курс", lead: "Единый читатель", highlights: [] },
      },
    });
  }
  if (url.pathname.startsWith("/library/products/reader-state-")) {
    if (selected.scenario === "archive" && !holder)
      return reply(
        {
          code: "discovery_not_found",
          status: 404,
          title: "Discovery not found",
          type: "urn:inside:problem:discovery_not_found",
        },
        404,
      );
    const original = envelope.parse(
      owner.baseRoute(
        "GET",
        new URL("/library/products/performance-course", url),
        holder,
      ),
    );
    const value = productSchema.parse(original.value);
    return reply({
      ...value,
      reference: {
        ...value.reference,
        id: selected.id,
        slug: selected.slug,
        name: `Reader state ${selected.scenario}`,
        productPage: {
          presentation: "ai-engineering-course",
          page: {
            card: null,
            blocks: [
              {
                id: "hero",
                kind: "hero",
                badge: "Курс",
                lead: "Проверочный состав",
                highlights: [],
              },
              {
                id: "status",
                kind: "list",
                title: "Что входит",
                text: "Один Product, независимые слоты",
                items: ["Практика", "Материалы"],
              },
            ],
          },
        },
      },
    });
  }
  if (url.pathname === "/billing/product-prices" && byId !== null) {
    if (["stopped", "archive", "waitlist"].includes(selected.scenario))
      return reply({ items: [], nextCursor: null });
    const original = envelope.parse(
      owner.baseRoute("GET", new URL("/billing/product-prices", url), holder),
    );
    const value = pricesSchema.parse(original.value);
    return reply({
      items: value.items.slice(0, 1).map((item) => ({
        ...item,
        product: {
          id: selected.id,
          name: `Reader state ${selected.scenario}`,
          priceRevision: 1,
        },
        supportMonths: 3,
        offer: {
          ...item.offer,
          benefits: [`product:${selected.id}`],
          benefitPeriods: [
            { capability: `product:${selected.id}`, months: null },
          ],
        },
      })),
      nextCursor: null,
    });
  }
  if (url.pathname === "/billing/product-sales-states" && byId !== null)
    return reply({
      items: [
        {
          productId: selected.id,
          revision: 1,
          name: "Проверочный набор",
          stage: "running",
          startsOn: "2020-01-01",
          nextEvent: "",
          priceAfterStartKopecks: null,
        },
      ],
      nextCursor: null,
    });
  if (url.pathname === `/accounts/current/products/${selected.id}/access`)
    return selected.scenario === "unknown"
      ? reply({ code: "dependency_unavailable" }, 503)
      : reply({ access: holder ? "open" : "closed" });
  if (url.pathname.startsWith(`/product-waitlists/${selected.id}/`))
    return selected.scenario === "waitlist"
      ? reply({
          intakeId: "17100000-0000-4000-8000-000000009999",
          name: "Постоянный набор",
          ...(url.pathname.endsWith("membership") ? { active: false } : {}),
        })
      : reply({ code: "intake_not_found" }, 404);
  if (
    url.pathname === `/reading-activity/product-continuation/${selected.slug}`
  )
    return reply({
      collection: {
        id: selected.id,
        slug: selected.slug,
        name: `Reader state ${selected.scenario}`,
        summary: null,
        cover: null,
        count: 120,
        previewItems: [],
      },
      read: 1,
      total: 120,
      started: true,
      continuation: {
        materialSlug: "performance-lesson-2",
        resume: { kind: "start" },
      },
    });
  if (url.pathname === "/accounts/current")
    return reply({
      account: { accountId: "17100000-0000-4000-8000-000000008888" },
    });
  if (url.pathname === "/accounts/current/billing")
    return reply({
      products: [],
      notices: [],
      payments: [],
      access: {
        grounds: holder
          ? [
              {
                source: selected.scenario === "paid" ? "paid" : "manual",
                capabilities: [`product:${selected.id}`],
                startsAt: null,
                validUntil: null,
                active: true,
              },
            ]
          : [],
      },
    });
  if (url.pathname.includes("community-entry"))
    return reply({
      kind: optionalTarget === "community-link" ? "link_telegram" : "member",
    });
  return null;
}
