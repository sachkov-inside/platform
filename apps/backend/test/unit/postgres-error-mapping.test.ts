import { describe, expect, test } from "vitest";

import { mapPostgresError } from "../../src/modules/materials/infrastructure/postgres/postgres-error-mapping.js";

describe("ContentAuthoring PostgreSQL error mapping", () => {
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
  });
});
