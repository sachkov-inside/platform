import { z } from "zod";

/** The periods the owner chooses between, in Moscow calendar days. */
export const OVERVIEW_PERIODS = [7, 30, 90] as const;
/** The period without an explicit choice. */
export const OVERVIEW_DEFAULT_PERIOD = 30;
/** The calendar every day of the Overview is counted in. */
export const OVERVIEW_TIME_ZONE = "Europe/Moscow";
/** The most events one feed shows, newest first, merged across its sources. */
export const OVERVIEW_EVENTS_LIMIT = 10;

export const overviewPeriodDaysSchema = z.literal(OVERVIEW_PERIODS);
export type OverviewPeriodDays = z.infer<typeof overviewPeriodDaysSchema>;

/** A query string carries text: `period` is one of the three choices or absent. */
export const overviewPeriodQuerySchema = z
  .enum(["7", "30", "90"])
  .transform((value): OverviewPeriodDays => {
    const days = Number(value);
    return days === 7 ? 7 : days === 90 ? 90 : 30;
  })
  .optional();

const periodRangeSchema = z.strictObject({
  from: z.iso
    .datetime({ offset: true })
    .describe("Moscow start of the first day, inclusive"),
  to: z.iso
    .datetime({ offset: true })
    .describe("Moscow start of the day after the last one, exclusive"),
  firstDay: z.iso.date(),
  lastDay: z.iso.date(),
});

export const overviewPeriodSchema = z.strictObject({
  days: overviewPeriodDaysSchema,
  timeZone: z.literal(OVERVIEW_TIME_ZONE),
  current: periodRangeSchema.describe("The last `days` days, today included"),
  previous: periodRangeSchema.describe(
    "The `days` days right before the current period",
  ),
});
export type OverviewPeriod = z.infer<typeof overviewPeriodSchema>;

export const overviewSeriesSchema = z.strictObject({
  total: z.int(),
  daily: z
    .array(z.strictObject({ date: z.iso.date(), value: z.int() }))
    .describe("One entry per day of the period, ascending, zeros included"),
});
export type OverviewSeries = z.infer<typeof overviewSeriesSchema>;

const unavailableSchema = z.strictObject({ state: z.literal("unavailable") });
const forbiddenSchema = z.strictObject({ state: z.literal("forbidden") });

export const overviewMetricSchema = z.discriminatedUnion("state", [
  unavailableSchema,
  z.strictObject({
    state: z.literal("ready"),
    current: overviewSeriesSchema,
    previous: overviewSeriesSchema,
  }),
]);
export type OverviewMetric = z.infer<typeof overviewMetricSchema>;

/** How a Product Access was first acquired, in the Overview's four groups. */
export const overviewOriginSchema = z.enum([
  "purchase",
  "course_activation",
  "manual",
  "other",
]);
export type OverviewOrigin = z.infer<typeof overviewOriginSchema>;

export const overviewOriginCountsSchema = z.strictObject({
  purchase: z.int().nonnegative(),
  course_activation: z.int().nonnegative(),
  manual: z.int().nonnegative(),
  other: z.int().nonnegative(),
});
export type OverviewOriginCounts = z.infer<typeof overviewOriginCountsSchema>;

export const overviewNewAccessMetricSchema = z.discriminatedUnion("state", [
  unavailableSchema,
  z.strictObject({
    state: z.literal("ready"),
    current: overviewSeriesSchema,
    previous: overviewSeriesSchema,
    byOrigin: overviewOriginCountsSchema.describe(
      "The current period's new accesses by first-acquisition origin",
    ),
  }),
]);

export const overviewAttentionItemSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    count: z.int().nonnegative(),
  }),
  forbiddenSchema,
  unavailableSchema,
]);
export type OverviewAttentionItem = z.infer<typeof overviewAttentionItemSchema>;

export const overviewSourceStateSchema = z.enum([
  "ready",
  "forbidden",
  "unavailable",
]);
export type OverviewSourceState = z.infer<typeof overviewSourceStateSchema>;

const productReferenceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
});

export const overviewPersonSchema = z
  .strictObject({
    accountId: z.uuid(),
    name: z.string().nullable(),
    username: z.string().nullable(),
  })
  .describe(
    "Telegram name and @username only with billing:manage; null without it or when unknown. Never an email",
  );
export type OverviewPerson = z.infer<typeof overviewPersonSchema>;

const eventBase = {
  occurredAt: z.iso.datetime({ offset: true }),
  person: overviewPersonSchema,
};

export const overviewEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("payment_confirmed"),
    ...eventBase,
    purchaseRef: z.uuid(),
    amountKopecks: z.int().nonnegative(),
    product: productReferenceSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("access_issued"),
    ...eventBase,
    origin: overviewOriginSchema,
    product: productReferenceSchema,
  }),
  z.strictObject({
    kind: z.literal("access_revoked"),
    ...eventBase,
    product: productReferenceSchema,
  }),
  z.strictObject({
    kind: z.literal("access_restored"),
    ...eventBase,
    product: productReferenceSchema,
  }),
  z.strictObject({
    kind: z.literal("submission"),
    ...eventBase,
    submissionId: z.uuid(),
    commented: z.boolean(),
    product: productReferenceSchema.nullable(),
    taskTitle: z.string().nullable(),
  }),
]);
export type OverviewEvent = z.infer<typeof overviewEventSchema>;

export const overviewEventsSchema = z
  .array(overviewEventSchema)
  .max(OVERVIEW_EVENTS_LIMIT)
  .describe("Newest first, merged across sources");

const averageProgressSchema = z
  .number()
  .min(0)
  .max(1)
  .nullable()
  .describe(
    "Mean share of programme Materials read over active holders; null without holders or programme Materials",
  );

export const authoringOverviewSchema = z.strictObject({
  period: overviewPeriodSchema,
  metrics: z.discriminatedUnion("state", [
    forbiddenSchema,
    z.strictObject({
      state: z.literal("ready"),
      revenue: overviewMetricSchema.describe(
        "Kopecks: confirmed purchases by confirmation day minus confirmed refunds by refund day",
      ),
      sales: overviewMetricSchema.describe(
        "Confirmed purchases by confirmation day",
      ),
      newAccess: overviewNewAccessMetricSchema.describe(
        "Product Access first issued that day",
      ),
      newAccounts: overviewMetricSchema.describe(
        "People registered that day, by the people list's person rule",
      ),
      waitlistJoins: overviewMetricSchema.describe(
        "Waitlist joins that day, every intake",
      ),
    }),
  ]),
  funnel: z.discriminatedUnion("state", [
    forbiddenSchema,
    unavailableSchema,
    z.strictObject({
      state: z.literal("ready"),
      product: productReferenceSchema
        .nullable()
        .describe(
          "The full report's default Product (its first); null without Products",
        ),
      steps: z.strictObject({
        entered: z.int().nonnegative().nullable(),
        openedChapter: z.int().nonnegative().nullable(),
        checkout: z.int().nonnegative().nullable(),
        paid: z.int().nonnegative().nullable(),
      }),
    }),
  ]),
  attention: z.strictObject({
    undeterminedPayments: overviewAttentionItemSchema.describe(
      "Payments whose bank result is unknown or only authorized",
    ),
    fulfillmentIncomplete: overviewAttentionItemSchema.describe(
      "Confirmed payments whose access is not yet applied",
    ),
    communityFailures: overviewAttentionItemSchema.describe(
      "People whose latest community operation failed or is overdue; the people list's telegram=community_failed total",
    ),
    telegramDeliveryFailures: overviewAttentionItemSchema.describe(
      "People with a Telegram delivery whose result is unknown, or that failed in the last 30 days; the people list's telegram=delivery_failed total",
    ),
    submissionsAwaitingFeedback: overviewAttentionItemSchema.describe(
      "Submissions without Author Feedback",
    ),
  }),
  events: z.strictObject({
    items: overviewEventsSchema,
    payments: overviewSourceStateSchema,
    access: overviewSourceStateSchema,
    submissions: overviewSourceStateSchema,
  }),
  learning: z.discriminatedUnion("state", [
    forbiddenSchema,
    unavailableSchema,
    z.strictObject({
      state: z.literal("ready"),
      products: z
        .array(
          z.strictObject({
            productId: z.uuid(),
            name: z.string(),
            holders: z.int().nonnegative(),
            started: z.int().nonnegative(),
            averageProgress: averageProgressSchema,
          }),
        )
        .describe(
          "Every non-archived Product, most holders first, then by name",
        ),
    }),
  ]),
});
export type AuthoringOverview = z.infer<typeof authoringOverviewSchema>;

export const productOverviewSchema = z.strictObject({
  period: overviewPeriodSchema,
  holders: z.discriminatedUnion("state", [
    unavailableSchema,
    z.strictObject({
      state: z.literal("ready"),
      active: z.int().nonnegative(),
      byOrigin: overviewOriginCountsSchema,
    }),
  ]),
  revenue: overviewMetricSchema,
  sales: overviewMetricSchema,
  waitlist: z.discriminatedUnion("state", [
    unavailableSchema,
    z.strictObject({
      state: z.literal("ready"),
      intake: z
        .strictObject({ name: z.string(), active: z.int().nonnegative() })
        .nullable()
        .describe("The intake accepting joins now; null when none does"),
    }),
  ]),
  learning: z.discriminatedUnion("state", [
    unavailableSchema,
    z.strictObject({
      state: z.literal("ready"),
      holders: z.int().nonnegative(),
      started: z.int().nonnegative(),
      averageProgress: averageProgressSchema,
    }),
  ]),
  events: z.discriminatedUnion("state", [
    unavailableSchema,
    z.strictObject({
      state: z.literal("ready"),
      items: overviewEventsSchema.describe(
        "Payments and access of this Product, newest first",
      ),
    }),
  ]),
});
export type ProductOverview = z.infer<typeof productOverviewSchema>;
