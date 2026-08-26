import { describe, expect, test } from "vitest";

import { mapPostgresError } from "../../src/modules/materials/shared/postgres-error-mapping.js";
import { MaterialRevisionMetadata } from "../../src/modules/materials/domain/material-revision-metadata.js";

describe("MaterialAuthoring PostgreSQL error mapping", () => {
  test("maps only allowlisted reference constraints", () => {
    expect(
      mapPostgresError({ code: "23503", constraint: "material_revisions_topic_fk" }),
    ).toEqual({
      code: "invalid_reference",
      issues: [{ code: "reference_not_found", path: "/metadata/topicId" }],
    });
    expect(
      mapPostgresError({
        code: "23503",
        constraint: "materials_current_draft_revision_fk",
      }),
    ).toMatchObject({ code: "internal_error" });
  });

  test("maps direct, caused and PostgreSQL connection failures as retryable", () => {
    expect(mapPostgresError({ code: "ECONNREFUSED" })).toEqual({
      code: "dependency_unavailable",
      retryable: true,
    });
    expect(mapPostgresError({ cause: { code: "ETIMEDOUT" } })).toEqual({
      code: "dependency_unavailable",
      retryable: true,
    });
    expect(mapPostgresError({ code: "08006" })).toEqual({
      code: "dependency_unavailable",
      retryable: true,
    });
    expect(mapPostgresError(new Error("Connection terminated unexpectedly"))).toEqual({
      code: "dependency_unavailable",
      retryable: true,
    });
    expect(
      mapPostgresError({
        code: "P1001",
        meta: {
          driverAdapterError: {
            cause: { kind: "DatabaseNotReachable" },
          },
        },
      }),
    ).toEqual({ code: "dependency_unavailable", retryable: true });
  });

  test("maps Prisma driver-adapter constraint metadata", () => {
    const metadata = MaterialRevisionMetadata.create({
      title: "Title",
      summary: "Summary",
      slug: "already-used",
      access: "free",
      topicId: "71000000-0000-4000-8000-000000000001",
      formatId: "71000000-0000-4000-8000-000000000002",
      tagIds: [],
      seriesMemberships: [],
    });
    if (!metadata.ok) {
      throw new Error(metadata.error.code);
    }
    expect(
      mapPostgresError(
        {
          code: "P2002",
          meta: {
            driverAdapterError: {
              cause: {
                kind: "UniqueConstraintViolation",
                originalCode: "23505",
                constraint: { fields: ["slug"] },
              },
            },
          },
        },
        metadata.value,
      ),
    ).toEqual({ code: "slug_conflict", slug: "already-used" });
  });
});
