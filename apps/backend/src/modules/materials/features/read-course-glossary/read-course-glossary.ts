import { randomUUID } from "node:crypto";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  CONTENT_ACCESS_BATCH_SIZE,
  type ContentAccess,
} from "../../../content-access/index.js";
import type { Glossary } from "../../../glossary/index.js";
import { materialId } from "../../domain/material-identifiers.js";
import type { MaterialProgrammeContext } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { discoverPublishedMaterialProjections } from "../discover-published-material-projections/discover-published-material-projections.js";
import type {
  CourseGlossaryResult,
  CourseGlossaryTermDto,
  ReadCourseGlossaryQuery,
} from "./read-course-glossary.contract.js";

const titleOrder = new Intl.Collator("ru", { sensitivity: "base" });

/**
 * The course Glossary page: every term a course lesson introduces, with a link to that lesson.
 * A term is listed only when the reader may read its introducing lesson, so the page shows no
 * definition the lesson itself would keep closed; terms introduced outside the course stay out.
 */
export async function readCourseGlossary(
  dependencies: MaterialProgrammeContext & {
    readonly prisma: MaterialsPrismaClient;
    readonly contentAccess: Pick<
      ContentAccess,
      "checkProductAccess" | "checkAvailabilityMany"
    >;
    readonly glossary?: Pick<Glossary, "introducedIn">;
  },
  query: ReadCourseGlossaryQuery,
): Promise<CourseGlossaryResult> {
  const page = await discoverPublishedMaterialProjections(
    dependencies,
    {
      kind: "product",
      slug: query.productSlug,
      subject: query.subject,
      first: null,
    },
    dependencies.contentAccess,
  );
  if (!page.ok) return page;
  const product = {
    slug: page.value.reference.slug,
    name: page.value.reference.name,
  };
  if (dependencies.glossary === undefined || page.value.items.length === 0)
    return { ok: true, value: { product, terms: [] } };

  const readable = new Set<string>();
  const items = page.value.items;
  for (
    let start = 0;
    start < items.length;
    start += CONTENT_ACCESS_BATCH_SIZE
  ) {
    const availability = await dependencies.contentAccess.checkAvailabilityMany(
      {
        subject: query.subject,
        operations: items
          .slice(start, start + CONTENT_ACCESS_BATCH_SIZE)
          .map((item) => ({
            itemId: item.materialId,
            resource: {
              kind: "material" as const,
              materialId: materialId(item.materialId),
            },
            action: "read" as const,
          })),
        enforcementPoint: "published_material_read",
        correlationId: randomUUID(),
      },
    );
    if (!availability.ok) return internalError();
    for (const item of availability.items)
      if (item.availability === "available") readable.add(item.itemId);
  }
  if (readable.size === 0) return { ok: true, value: { product, terms: [] } };

  let sources;
  try {
    sources = await dependencies.prisma.material.findMany({
      where: { id: { in: [...readable] }, sourceId: { not: null } },
      select: { id: true, sourceId: true },
    });
  } catch (error) {
    return {
      ok: false,
      error: dependencyFailure(
        { module: "materials", operation: "readCourseGlossary" },
        error,
        mapPostgresReadError(error),
      ),
    };
  }
  const lessonBySource = new Map(
    sources.flatMap((row) => {
      const lesson = items.find((item) => item.materialId === row.id);
      return row.sourceId === null || lesson === undefined
        ? []
        : [[row.sourceId, { slug: lesson.slug, title: lesson.title }] as const];
    }),
  );
  const introduced = await dependencies.glossary.introducedIn([
    ...lessonBySource.keys(),
  ]);
  if (!introduced.ok) return introduced;
  const terms = introduced.value.flatMap((term): CourseGlossaryTermDto[] => {
    const lesson =
      term.introducedInSourceId === null
        ? undefined
        : lessonBySource.get(term.introducedInSourceId);
    return lesson === undefined
      ? []
      : [
          {
            id: term.id,
            title: term.title,
            englishTitle: term.englishTitle,
            shortDefinition: term.shortDefinition,
            fullDefinition: term.fullDefinition,
            lesson,
          },
        ];
  });
  // The Glossary returns terms in identifier order and the sort is stable.
  terms.sort((left, right) => titleOrder.compare(left.title, right.title));
  return { ok: true, value: { product, terms } };
}

function internalError(): CourseGlossaryResult {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
