import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type SalesFunnelPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import type { BillingGuideSales } from "../../../billing/index.js";
import type { GuideOutlines } from "../../../materials/index.js";
import type { MaterialFirstOpens } from "../../../reading-activity/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  funnelReportQuerySchema,
  type FunnelCounts,
  type FunnelReport,
  type FunnelReportErrorCode,
  type FunnelReportResult,
  type FunnelSource,
} from "./read-funnel-report.contract.js";

export type ReadFunnelReportDependencies = {
  readonly prisma: SalesFunnelPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly links: Pick<TelegramAccountLinks, "findCurrentAccounts">;
  readonly outlines: Pick<GuideOutlines, "list">;
  readonly firstOpens: Pick<MaterialFirstOpens, "list">;
  readonly sales: Pick<BillingGuideSales, "list">;
  readonly clock: () => Date;
};

type PlatformStep = "openedChapter" | "checkout" | "paid";
const platformSteps: readonly PlatformStep[] = [
  "openedChapter",
  "checkout",
  "paid",
];

const contactRowsSchema = z.array(
  z.object({
    source_code: z.string().nullable(),
    entered_at: z.date().nullable(),
    consented_at: z.date().nullable(),
    account_id: z.uuid().nullable(),
    telegram_identity_ref: z.string().nullable(),
  }),
);
type ContactRow = z.infer<typeof contactRowsSchema>[number];
const lastReceivedSchema = z.array(
  z.object({ received_at: z.date().nullable() }),
);

// Row keys: a label is prefixed so that no label can collide with the two other kinds.
const UNLABELLED = "unlabelled";
const OUTSIDE_BOT = "outside_bot";
const LABEL_PREFIX = "label:";
type SourceKey = string;
const keyOf = (sourceCode: string | null): SourceKey =>
  sourceCode === null ? UNLABELLED : `${LABEL_PREFIX}${sourceCode}`;

const failure = (code: FunnelReportErrorCode): FunnelReportResult => ({
  ok: false,
  error: { code },
});

/**
 * The sales funnel of one Guide for the cohort that entered in `[from, to)` (owner decision of
 * 2026-09-30, #816): bot contacts whose first bot entry falls in the period, and Accounts without
 * a known bot entry whose first step for this Guide falls in it. Every later step counts who of
 * that cohort has reached it by now.
 */
export async function readFunnelReport(
  dependencies: ReadFunnelReportDependencies,
  actorId: string,
  input: unknown,
): Promise<FunnelReportResult> {
  const parsed = funnelReportQuerySchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (from >= to) return failure("invalid_request");
  const within = (at: Date | null | undefined) =>
    at !== null && at !== undefined && at >= from && at < to;
  const permission = await dependencies.accounts.checkPermission({
    accountId: actorId,
    permission: "billing:manage",
  });
  if (!permission.ok)
    return failure(
      permission.error.code === "internal_error"
        ? "dependency_unavailable"
        : "forbidden",
    );
  if (!permission.allowed) return failure("forbidden");

  const outlines = await dependencies.outlines.list();
  if (!outlines.ok) return failure("dependency_unavailable");
  const guide =
    parsed.data.guideId === undefined
      ? undefined
      : outlines.value.find((item) => item.id === parsed.data.guideId);
  if (parsed.data.guideId !== undefined && guide === undefined)
    return failure("guide_not_found");
  if (guide === undefined && parsed.data.chapterId !== undefined)
    return failure("invalid_request");
  const chapter =
    guide === undefined
      ? undefined
      : parsed.data.chapterId === undefined
        ? guide.chapters[0]
        : guide.chapters.find((item) => item.id === parsed.data.chapterId);
  if (parsed.data.chapterId !== undefined && chapter === undefined)
    return failure("chapter_not_found");

  const journal = await readJournal(dependencies.prisma);
  if (journal === undefined) return failure("dependency_unavailable");
  const measured: Readonly<Record<PlatformStep, boolean>> = {
    openedChapter: guide !== undefined && chapter !== undefined,
    checkout: guide !== undefined,
    paid: guide !== undefined,
  };

  const rows = new Map<SourceKey, FunnelCounts>();
  const row = (key: SourceKey) => {
    let counts = rows.get(key);
    if (counts === undefined) {
      counts = {
        entered: key === OUTSIDE_BOT ? null : 0,
        consented: key === OUTSIDE_BOT ? null : 0,
        openedChapter: measured.openedChapter ? 0 : null,
        checkout: measured.checkout ? 0 : null,
        paid: measured.paid ? 0 : null,
      };
      rows.set(key, counts);
    }
    return counts;
  };
  for (const contact of journal.contacts) {
    if (!within(contact.entered_at)) continue;
    const counts = row(keyOf(contact.source_code));
    counts.entered = (counts.entered ?? 0) + 1;
    if (contact.consented_at !== null)
      counts.consented = (counts.consented ?? 0) + 1;
  }

  if (guide !== undefined) {
    const attribution = await attributeAccounts(
      dependencies.links,
      journal.contacts,
    );
    if (attribution === undefined) return failure("dependency_unavailable");
    const [opens, productOpens, sales] = await Promise.all([
      chapter === undefined
        ? Promise.resolve({ ok: true as const, value: new Map<string, Date>() })
        : dependencies.firstOpens.list(chapter.materialIds),
      dependencies.firstOpens.list(
        guide.chapters.flatMap((item) => item.materialIds),
      ),
      dependencies.sales.list(guide.id),
    ]);
    if (!opens.ok || !productOpens.ok || !sales.ok)
      return failure("dependency_unavailable");
    const reached: Readonly<Record<PlatformStep, ReadonlyMap<string, Date>>> = {
      openedChapter: opens.value,
      checkout: sales.value.checkout,
      paid: sales.value.paid,
    };
    const accountIds = new Set([
      ...attribution.keys(),
      ...productOpens.value.keys(),
      ...platformSteps.flatMap((step) => [...reached[step].keys()]),
    ]);
    for (const accountId of accountIds) {
      const source = attribution.get(accountId);
      // An Account without a known bot entry joins the cohort by its first step for this Guide,
      // whichever chapter the report shows.
      const inCohort =
        source === undefined
          ? within(
              firstAt(accountId, [
                productOpens.value,
                sales.value.checkout,
                sales.value.paid,
              ]),
            )
          : within(source.enteredAt);
      if (!inCohort) continue;
      const counts = row(source?.key ?? OUTSIDE_BOT);
      for (const step of platformSteps)
        if (reached[step].has(accountId))
          counts[step] = (counts[step] ?? 0) + 1;
    }
  }

  const ordered = [...rows.entries()]
    .map(([key, counts]) => ({ source: sourceOf(key), counts }))
    .sort((left, right) => {
      const byKind = sourceRank(left.source) - sourceRank(right.source);
      return byKind !== 0
        ? byKind
        : sourceCode(left.source).localeCompare(sourceCode(right.source));
    });
  const total = (step: keyof FunnelCounts, isMeasured: boolean) =>
    isMeasured ? sum(ordered.map((item) => item.counts[step] ?? 0)) : null;
  // Before the bot reports anything its steps are unknown, not zero.
  const botConnected = journal.lastReceivedAt !== null;
  const report: FunnelReport = {
    generatedAt: dependencies.clock().toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    guides: outlines.value.map((item) => ({
      id: item.id,
      name: item.name,
      chapters: item.chapters.map(({ id, name }) => ({ id, name })),
    })),
    selection:
      guide === undefined
        ? null
        : { guideId: guide.id, chapterId: chapter?.id ?? null },
    lastBotEventReceivedAt: journal.lastReceivedAt?.toISOString() ?? null,
    rows: ordered,
    total: {
      entered: total("entered", botConnected),
      consented: total("consented", botConnected),
      openedChapter: total("openedChapter", measured.openedChapter),
      checkout: total("checkout", measured.checkout),
      paid: total("paid", measured.paid),
    },
  };
  return { ok: true, value: report };
}

function firstAt(
  accountId: string,
  steps: readonly ReadonlyMap<string, Date>[],
): Date | undefined {
  const times = steps.flatMap((step) => {
    const at = step.get(accountId);
    return at === undefined ? [] : [at.getTime()];
  });
  return times.length === 0 ? undefined : new Date(Math.min(...times));
}

/** The first entry of every contact: its source and time. */
const firstEntries = Prisma.sql`
  select distinct on (contact_ref) contact_ref, source_code, occurred_at
  from sales_funnel.bot_events
  where kind = 'bot_entered'
  order by contact_ref, occurred_at, event_id
`;

/**
 * Every contact with its first entry, its first consent and its latest reported link, or
 * undefined when the journal is unavailable.
 */
async function readJournal(prisma: SalesFunnelPrismaClient) {
  try {
    const [contacts, lastReceived] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        select
          entry.source_code,
          entry.occurred_at as entered_at,
          consent.granted_at as consented_at,
          link.account_id,
          link.telegram_identity_ref
        from (select distinct contact_ref from sales_funnel.bot_events) as contact
        left join (${firstEntries}) as entry using (contact_ref)
        left join (
          select contact_ref, min(occurred_at) as granted_at
          from sales_funnel.bot_events
          where kind = 'marketing_consent' and granted
          group by contact_ref
        ) as consent using (contact_ref)
        left join (
          select distinct on (contact_ref) contact_ref, account_id, telegram_identity_ref
          from sales_funnel.bot_events
          where kind = 'account_linked'
          order by contact_ref, occurred_at desc, event_id desc
        ) as link using (contact_ref)
      `),
      prisma.$queryRaw(Prisma.sql`
        select max(received_at) as received_at from sales_funnel.bot_events
      `),
    ]);
    return {
      contacts: contactRowsSchema.parse(contacts),
      lastReceivedAt:
        lastReceivedSchema.parse(lastReceived)[0]?.received_at ?? null,
    };
  } catch (error) {
    return dependencyFailure(
      { module: "sales-funnel", operation: "readFunnelReport" },
      error,
      undefined,
    );
  }
}

/**
 * The source of each Account is the one of its linked contact that entered the bot first. The
 * Account stored when the link was reported wins, so a later unlink keeps the source; a link
 * reported before Platform knew it is resolved through the current Telegram link. A linked
 * contact without an entry gives no source.
 */
async function attributeAccounts(
  links: Pick<TelegramAccountLinks, "findCurrentAccounts">,
  contacts: readonly ContactRow[],
): Promise<
  | ReadonlyMap<string, { readonly key: SourceKey; readonly enteredAt: Date }>
  | undefined
> {
  const resolved = await links.findCurrentAccounts(
    contacts.flatMap((contact) =>
      contact.entered_at !== null &&
      contact.account_id === null &&
      contact.telegram_identity_ref !== null
        ? [contact.telegram_identity_ref]
        : [],
    ),
  );
  if (!resolved.ok) return undefined;
  const earliest = new Map<
    string,
    { readonly key: SourceKey; readonly enteredAt: Date }
  >();
  for (const contact of contacts) {
    if (contact.entered_at === null || contact.telegram_identity_ref === null)
      continue;
    const accountId =
      contact.account_id ??
      resolved.accounts.get(contact.telegram_identity_ref);
    if (accountId === undefined) continue;
    const current = earliest.get(accountId);
    if (current !== undefined && current.enteredAt <= contact.entered_at)
      continue;
    earliest.set(accountId, {
      key: keyOf(contact.source_code),
      enteredAt: contact.entered_at,
    });
  }
  return earliest;
}

function sourceOf(key: SourceKey): FunnelSource {
  if (key === OUTSIDE_BOT) return { kind: "outside_bot" };
  if (key === UNLABELLED) return { kind: "unlabelled" };
  return { kind: "label", code: key.slice(LABEL_PREFIX.length) };
}

function sourceRank(source: FunnelSource) {
  return { label: 0, unlabelled: 1, outside_bot: 2 }[source.kind];
}

function sourceCode(source: FunnelSource) {
  return source.kind === "label" ? source.code : "";
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
