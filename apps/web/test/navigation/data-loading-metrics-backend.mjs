// @ts-check
import { z } from "zod";

export const metricsProductId = "11111111-1111-4111-8111-111111111115";
export const metricsMaterialId = "33333333-3333-4333-8333-333333339901";
export const metricsLessonSlug = "data-loading-image-lesson";
export const authoredImages = {
  wideLight: {
    assetId: "77777777-7777-4777-8777-777777779901",
    width: 960,
    height: 420,
  },
  wideDark: {
    assetId: "77777777-7777-4777-8777-777777779902",
    width: 960,
    height: 500,
  },
  tallLight: {
    assetId: "77777777-7777-4777-8777-777777779903",
    width: 420,
    height: 900,
  },
  tallDark: {
    assetId: "77777777-7777-4777-8777-777777779904",
    width: 420,
    height: 1100,
  },
};
const envelope = z.object({ status: z.number(), value: z.unknown() });
const productSchema = z
  .object({
    reference: z
      .object({
        productPage: z
          .object({ page: z.object({ blocks: z.array(z.unknown()) }).loose() })
          .loose(),
      })
      .loose(),
  })
  .loose();
const priceSchema = z
  .object({
    items: z.array(
      z
        .object({
          paymentOption: z.object({}).loose(),
          offer: z
            .object({
              benefits: z.array(z.string()),
              benefitPeriods: z.array(z.unknown()),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose();
const homeSchema = z.object({ pinnedSeries: z.object({}).loose() }).loose();
const readerSchema = z.object({
  projection: z.object({}).loose(),
  body: z.object({ blocks: z.array(z.unknown()) }).loose(),
});
const controls = z
  .object({
    enabled: z.boolean().optional(),
    reset: z.boolean().optional(),
    subscriptionOffered: z.boolean().optional(),
    priceKopecks: z.number().int().positive().optional(),
    cohortRevision: z.number().int().positive().optional(),
    startsOn: z.iso.date().optional(),
  })
  .strict();
/** @type {{role: string, method: string, path: string, status: number, bytes: number}[]} */
let records = [];
let enabled = false;
let subscriptionOffered = false;
let priceKopecks = 990000;
let cohortRevision = 1;
let startsOn = "2026-11-15";

/** Fixture measurements count physical HTTP responses, never database statements or provider calls.
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @param {{baseRoute: (method: string | undefined, url: URL, entitled: boolean) => unknown, reader: () => unknown, image: (size: {width: number, height: number}) => {status: number, contentType: string, value: Buffer}}} owners
 * @returns {Promise<{status: number, value: unknown, contentType?: string} | null>}
 */
export async function dataLoadingMetricsRoute(request, url, readBody, owners) {
  if (url.pathname === "/__data-loading") {
    if (request.method === "POST") {
      const input = controls.parse(JSON.parse(await readBody(request)));
      enabled = input.enabled ?? enabled;
      subscriptionOffered = input.subscriptionOffered ?? subscriptionOffered;
      priceKopecks = input.priceKopecks ?? priceKopecks;
      cohortRevision = input.cohortRevision ?? cohortRevision;
      startsOn = input.startsOn ?? startsOn;
      if (input.reset === true) records = [];
    }
    return { status: 200, value: { enabled, subscriptionOffered, records } };
  }
  if (!enabled) return null;
  const role =
    request.headers.authorization === undefined
      ? "guest"
      : request.headers.authorization === "Bearer matrix-active-owner"
        ? "active-owner"
        : "non-owner";
  const entitled = role === "active-owner";
  /** @type {{status: number, value: unknown, contentType?: string} | undefined} */
  let result;
  if (
    url.pathname === `/library/products/performance-course` ||
    url.pathname === `/library/series/performance-course`
  ) {
    const base = envelope.parse(
      owners.baseRoute(request.method, url, entitled),
    );
    const value = productSchema.parse(base.value);
    result = {
      ...base,
      value: {
        ...value,
        reference: {
          ...value.reference,
          productPage: {
            ...value.reference.productPage,
            page: {
              ...value.reference.productPage.page,
              blocks: [
                ...value.reference.productPage.page.blocks,
                {
                  id: "status",
                  kind: "list",
                  title: "Что входит",
                  text: "Два независимых блока одного потока",
                  items: ["Практика", "Материалы"],
                },
              ],
            },
          },
        },
      },
    };
  } else if (url.pathname === "/billing/cohorts") {
    result = {
      status: 200,
      value: {
        nextCursor: null,
        items: [
          {
            productId: metricsProductId,
            revision: cohortRevision,
            name: "Проверочный поток",
            stage: "preorder",
            startsOn,
            nextEvent: "Старт потока",
            priceAfterStartKopecks: 1490000,
          },
        ],
      },
    };
  } else if (url.pathname === "/billing/offers") {
    const base = envelope.parse(
      owners.baseRoute(
        request.method,
        new URL("/billing/offers", url),
        entitled,
      ),
    );
    const value = priceSchema.parse(base.value);
    result = {
      status: 200,
      value: {
        items: value.items.slice(0, 1).map((item) => ({
          ...item,
          firstPriceKopecks: priceKopecks - (role === "non-owner" ? 100000 : 0),
          renewalPriceKopecks:
            priceKopecks - (role === "non-owner" ? 100000 : 0),
          paymentOption: {
            ...item.paymentOption,
            priceKopecks: priceKopecks - (role === "non-owner" ? 100000 : 0),
          },
          offer: {
            ...item.offer,
            benefits: [`product:${metricsProductId}`],
            benefitPeriods: [
              { capability: `product:${metricsProductId}`, months: null },
            ],
          },
        })),
        nextCursor: null,
      },
    };
  } else if (url.pathname === "/library/products/sale-availability") {
    result = {
      status: 200,
      value: {
        items: url.searchParams.getAll("productId").map((productId) => ({
          productId,
          sold: productId === metricsProductId,
        })),
      },
    };
  } else if (url.pathname === "/accounts/current") {
    result =
      role === "guest"
        ? { status: 401, value: { code: "invalid_proof" } }
        : {
            status: 200,
            value: {
              account: {
                accountId:
                  role === "active-owner"
                    ? "55555555-5555-4555-8555-555555555501"
                    : "55555555-5555-4555-8555-555555555502",
              },
            },
          };
  } else if (
    url.pathname === `/accounts/current/products/${metricsProductId}/access`
  ) {
    result = {
      status: role === "guest" ? 401 : 200,
      value: { access: entitled ? "open" : "closed" },
    };
  } else if (
    url.pathname === `/materials/${metricsLessonSlug}` ||
    url.pathname === "/materials/data-loading-subscription-lesson"
  ) {
    const template = readerSchema.parse(owners.reader());
    const subscription = url.pathname.endsWith(
      "data-loading-subscription-lesson",
    );
    const projection = {
      ...template.projection,
      ...(subscription ? { seriesMemberships: [] } : {}),
      materialId: metricsMaterialId,
      slug: subscription
        ? "data-loading-subscription-lesson"
        : metricsLessonSlug,
      access: "closed",
      title: "Четыре варианта изображения",
    };
    const imageVariants = Object.fromEntries(
      Object.entries(authoredImages).map(([key, value]) => [
        key,
        { ...value, variants: [{ width: value.width, height: value.height }] },
      ]),
    );
    const wide = authoredImages.wideLight;
    result =
      role === "guest"
        ? {
            status: 200,
            value: {
              kind: "teaser",
              cacheScope: "private-no-store",
              projection,
              access: { availability: "locked", subscriptionOffered },
            },
          }
        : {
            status: 200,
            value: {
              kind: "available",
              cacheScope: "private-no-store",
              primaryVideo: null,
              projection,
              body: {
                ...template.body,
                blocks: [
                  {
                    kind: "image",
                    ...wide,
                    alt: "Схема четырёх вариантов",
                    caption: "Изображение по колонке и ручной теме",
                    sourceSrc: "assets/diagram.png",
                    variants: [{ width: wide.width, height: wide.height }],
                    imageVariants,
                  },
                  ...template.body.blocks,
                ],
              },
            },
          };
  } else if (
    url.pathname.startsWith(`/materials/${metricsMaterialId}/assets/`)
  ) {
    const rendition = Object.values(authoredImages).find(({ assetId }) =>
      url.pathname.includes(`/assets/${assetId}/images/`),
    );
    result =
      role === "guest" || rendition === undefined
        ? { status: 403, value: { code: "content_access_denied" } }
        : owners.image(rendition);
  } else if (
    url.pathname === `/library/materials/${metricsLessonSlug}/practices`
  ) {
    result = { status: 200, value: { practices: [] } };
  } else if (
    url.pathname === "/library/home" ||
    url.pathname === "/library/materials"
  ) {
    const base = owners.baseRoute(request.method, url, entitled);
    if (base !== undefined) {
      result = envelope.parse(base);
      if (url.pathname === "/library/home") {
        const value = homeSchema.parse(result.value);
        result = {
          ...result,
          value: {
            ...value,
            pinnedSeries: {
              ...value.pinnedSeries,
              id: metricsProductId,
              slug: "performance-course",
              name: "Курс на 120 материалов",
            },
          },
        };
      }
    }
  }
  if (result === undefined) return null;
  records.push({
    role,
    method: request.method ?? "GET",
    path: url.pathname + url.search,
    status: result.status,
    bytes: Buffer.isBuffer(result.value)
      ? result.value.byteLength
      : Buffer.byteLength(JSON.stringify(result.value)),
  });
  return result;
}
