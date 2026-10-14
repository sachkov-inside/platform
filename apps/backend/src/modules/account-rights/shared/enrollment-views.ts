import { z } from "zod";
import { tariffCoverage } from "@inside/access-capabilities";
import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { AccountRightsPrisma } from "../infrastructure/prisma.js";
import {
  COVERAGE_CATALOG_ENTRY_LIMIT,
  type CoverageCatalog,
} from "../ports/coverage-catalog.js";
import {
  enrollmentView,
  enrollmentBenefitTerms,
  projectEnrollmentSourceState,
} from "./enrollment-view.js";

const historyRowsSchema = z.array(
  z.object({
    enrollment_id: z.uuid(),
    kind: z.string(),
    reason: z.string(),
    recorded_at: z.date(),
  }),
);

/** Enrich only the selected Account's Enrollment set; history is capped per Enrollment. */
export async function assembleEnrollmentViews(
  prisma: AccountRightsPrisma,
  rows: readonly Parameters<typeof enrollmentView>[0][],
  now: Date,
  catalog: CoverageCatalog | undefined,
  includeHistory: boolean,
) {
  const result = [];
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const ids = chunk.map((row) => row.id);
    const grants = await prisma.accessGrant.findMany({
      where: { enrollmentId: { in: ids } },
    });
    const sources = await prisma.sourceEntitlement.findMany({
      where: { enrollmentId: { in: ids }, origin: "tribute" },
    });
    const grantsByEnrollment = new Map<string, typeof grants>();
    for (const grant of grants) {
      if (grant.enrollmentId === null) continue;
      const grouped = grantsByEnrollment.get(grant.enrollmentId) ?? [];
      grouped.push(grant);
      grantsByEnrollment.set(grant.enrollmentId, grouped);
    }
    const sourcesByEnrollment = new Map<
      string | null,
      (typeof sources)[number]
    >();
    for (const source of sources) {
      if (!sourcesByEnrollment.has(source.enrollmentId))
        sourcesByEnrollment.set(source.enrollmentId, source);
    }
    const views = chunk.map((row) => {
      const view = enrollmentView(row, now);
      if (row.origin === "tribute" && view.state !== "revoked")
        view.state =
          projectEnrollmentSourceState(sourcesByEnrollment.get(row.id), now) ??
          view.state;
      return view;
    });
    const content =
      catalog === undefined
        ? undefined
        : await resolveEnrollmentContent(
            catalog,
            views.map((view) =>
              tariffCoverage(view.tier.benefits, view.tier.coverage),
            ),
          );
    const history = includeHistory
      ? historyRowsSchema.parse(
          await prisma.$queryRaw(Prisma.sql`
      SELECT enrollment_id, kind, reason, recorded_at FROM (
        SELECT grants.enrollment_id, changes.kind, changes.reason, changes.recorded_at,
          row_number() OVER (PARTITION BY grants.enrollment_id ORDER BY changes.revision DESC) AS position,
          changes.revision
        FROM account_rights.access_changes AS changes
        JOIN account_rights.access_grants AS grants ON grants.id = changes.grant_id
        WHERE grants.enrollment_id = ANY(${ids}::uuid[]) AND changes.account_id = ANY(${[...new Set(chunk.map((row) => row.accountId))]}::uuid[])
      ) AS recent WHERE position <= 100 ORDER BY enrollment_id, revision DESC
    `),
        )
      : [];
    const historyByEnrollment = new Map<string, typeof history>();
    for (const entry of history) {
      const grouped = historyByEnrollment.get(entry.enrollment_id) ?? [];
      grouped.push(entry);
      historyByEnrollment.set(entry.enrollment_id, grouped);
    }
    for (const [index, view] of views.entries())
      result.push({
        ...view,
        benefitTerms: enrollmentBenefitTerms(
          grantsByEnrollment.get(view.id) ?? [],
        ),
        ...(content === undefined ? {} : { content: content[index] ?? [] }),
        ...(includeHistory
          ? {
              history: (historyByEnrollment.get(view.id) ?? []).map(
                (entry) => ({
                  kind: entry.kind,
                  reason: entry.reason,
                  recordedAt: entry.recorded_at.toISOString(),
                }),
              ),
            }
          : {}),
      });
  }
  return result;
}

/** Pack explicit references to the port's bound; a whole-platform read owns its unknown-sized set. */
async function resolveEnrollmentContent(
  catalog: CoverageCatalog,
  scopes: ReturnType<typeof tariffCoverage>[],
) {
  const result: Awaited<ReturnType<CoverageCatalog["resolveMany"]>> = [];
  const whole = scopes.flatMap((scope, index) =>
    scope.wholePlatform === true ? [index] : [],
  );
  if (whole.length > 0) {
    const first = whole[0];
    if (first === undefined) throw new Error("Missing whole-platform scope");
    const [entries] = await catalog.resolveMany([scopes[first]]);
    for (const index of whole) result[index] = [...(entries ?? [])];
  }
  let indexes: number[] = [];
  let batch: typeof scopes = [];
  let references = new Set<string>();
  async function flush() {
    if (batch.length === 0) return;
    const contents = await catalog.resolveMany(batch);
    for (const [position, index] of indexes.entries())
      result[index] = contents[position] ?? [];
    indexes = [];
    batch = [];
    references = new Set();
  }
  for (const [index, scope] of scopes.entries()) {
    if (scope.wholePlatform === true) continue;
    const added = [
      ...scope.productIds.map((id) => `product/${id.toLowerCase()}`),
      ...scope.materialIds.map((id) => `material/${id.toLowerCase()}`),
    ];
    const union = new Set([...references, ...added]);
    if (union.size > COVERAGE_CATALOG_ENTRY_LIMIT) await flush();
    for (const reference of added) references.add(reference);
    batch.push(scope);
    indexes.push(index);
  }
  await flush();
  return result;
}
