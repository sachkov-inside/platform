// @ts-check
import { z } from "zod";

const cases = [
  "none",
  "sole",
  "multiple",
  "explicit",
  "unavailable",
  "malformed",
  "missing",
];
const controlSchema = z.strictObject({
  reset: z.literal(true),
  unavailable: z.boolean().optional(),
});
let unavailable = true;
/** @type {{ path: string; authorized: boolean; bytes: number; status: number }[]} */
let reads = [];

/** @param {string} slug */
function fixture(slug) {
  const parts =
    /^reader-sale-(1|10|100)-(none|sole|multiple|explicit|unavailable|malformed|missing)$/u.exec(
      slug,
    );
  if (parts === null) return undefined;
  const size = Number(parts[1]);
  const scenario = parts[2] ?? "none";
  const caseNumber = cases.indexOf(scenario) + 1;
  return {
    slug,
    size,
    scenario,
    memberships: Array.from({ length: size }, (_, index) => ({
      ordinal: index + 1,
      series: {
        id: `50001466-0000-4000-8000-${String(caseNumber * 100000 + size * 100 + index).padStart(12, "0")}`,
        name: `Reader sale Product ${String(index + 1)}`,
        slug: `reader-sale-product-${size}-${scenario}-${String(index + 1)}`,
      },
    })),
  };
}
const fixtures = [1, 10, 100].flatMap((size) =>
  cases.flatMap((scenario) => {
    const value = fixture(`reader-sale-${String(size)}-${scenario}`);
    return value === undefined ? [] : [value];
  }),
);
/** @param {string} id */
function productOf(id) {
  for (const value of fixtures) {
    const membership = value.memberships.find(({ series }) => series.id === id);
    if (membership !== undefined) return { value, membership };
  }
  return undefined;
}
/** @param {NonNullable<ReturnType<typeof productOf>>} product */
function sold(product) {
  return (
    product.value.scenario === "explicit" ||
    (product.value.scenario === "sole" &&
      product.membership.ordinal === product.value.size) ||
    (product.value.scenario === "multiple" && product.membership.ordinal <= 2)
  );
}

/** Isolated HTTP evidence only; real PostgreSQL tests own admission and authorization proof.
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @param {object} projectionTemplate
 * @returns {Promise<{status: number; value: unknown} | null>}
 */
export async function readerSaleAvailabilityRoute(
  request,
  url,
  readBody,
  projectionTemplate,
) {
  if (url.pathname === "/__reader-sale") {
    if (request.method === "POST") {
      const control = controlSchema.parse(JSON.parse(await readBody(request)));
      unavailable = control.unavailable ?? true;
      reads = [];
    }
    return { status: 200, value: { reads } };
  }
  /** @param {unknown} value @param {number} [status] */
  const reply = (value, status = 200) => {
    reads.push({
      path: `${url.pathname}${url.search}`,
      authorized: request.headers.authorization !== undefined,
      status,
      bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
    });
    return { status, value };
  };
  const materialSlug = url.pathname.startsWith("/materials/")
    ? url.pathname.slice("/materials/".length)
    : "";
  const material = fixture(materialSlug);
  if (material !== undefined) {
    const memberships = material.memberships.map((membership, index) => {
      if (index !== 0) return membership;
      if (material.scenario === "malformed")
        return {
          ...membership,
          series: { ...membership.series, id: "bad-id" },
        };
      if (material.scenario === "missing") {
        const { id: _id, ...series } = membership.series;
        return { ...membership, series };
      }
      return membership;
    });
    return reply({
      kind: "teaser",
      cacheScope: "private-no-store",
      access: { availability: "locked", subscriptionOffered: false },
      projection: {
        ...projectionTemplate,
        access: "closed",
        materialId: "50001466-0000-4000-8000-000000009999",
        slug: material.slug,
        title: `Reader sale ${String(material.size)} ${material.scenario}`,
        seriesMemberships: memberships,
      },
    });
  }
  if (url.pathname === "/library/products/sale-availability") {
    const ids = url.searchParams.getAll("productId");
    const products = ids.map(productOf);
    if (
      products.length === 0 ||
      products.some((product) => product === undefined)
    )
      return null;
    if (
      unavailable &&
      products.some((product) => product?.value.scenario === "unavailable")
    )
      return reply({ code: "dependency_unavailable" }, 503);
    return reply({
      items: products.flatMap((product) =>
        product === undefined
          ? []
          : [{ productId: product.membership.series.id, sold: sold(product) }],
      ),
    });
  }
  if (url.pathname.startsWith("/library/products/reader-sale-product-")) {
    const slug = url.pathname.slice("/library/products/".length);
    const product = fixtures
      .flatMap((value) =>
        value.memberships.map((membership) => ({ value, membership })),
      )
      .find(({ membership }) => membership.series.slug === slug);
    if (product === undefined) return null;
    return reply({
      kind: "series",
      reference: {
        ...product.membership.series,
        cover: null,
        hasModeVariants: false,
        introduction: null,
        summary: "Reader sale programme fixture",
      },
      chapters: [],
      items: [
        {
          ...projectionTemplate,
          slug: product.value.slug,
          title: `Reader sale ${String(product.value.size)} ${product.value.scenario}`,
          availability: "locked",
          seriesMemberships: product.value.memberships,
        },
      ],
      hasNext: false,
      relatedSeries: [],
      topics: [],
    });
  }
  if (url.pathname === "/billing/cohorts") {
    const id = url.searchParams.get("productId");
    if (id === null || productOf(id) === undefined) return null;
    return reply({ items: [], nextCursor: null });
  }
  if (url.pathname === "/billing/offers") {
    const capability = url.searchParams.get("capability");
    const product =
      capability?.startsWith("product:") === true
        ? productOf(capability.slice(8))
        : undefined;
    if (product === undefined) return null;
    const id = product.membership.series.id;
    return reply({
      items: sold(product)
        ? [
            {
              currency: "RUB",
              firstPriceKopecks: 990000,
              renewalPriceKopecks: 990000,
              timezone: "Europe/Moscow",
              promotion: null,
              offer: {
                archived: false,
                published: true,
                id,
                name: product.membership.series.name,
                revision: 1,
                benefits: [`product:${id}`],
                benefitPeriods: [{ capability: `product:${id}`, months: null }],
              },
              paymentOption: {
                archived: false,
                id,
                offerId: id,
                revision: 1,
                mode: "one_time",
                months: 1,
                priceKopecks: 990000,
              },
            },
          ]
        : [],
      nextCursor: null,
    });
  }
  return null;
}
