import { describe, expect, test } from "vitest";

import { mapPostgresError } from "../../src/modules/materials/shared/postgres-error-mapping.js";

describe("MaterialAuthoring PostgreSQL error mapping", () => {
  test("maps only allowlisted reference constraints", () => {
    expect(
      mapPostgresError({ code: "23503", constraint: "materials_topic_fk" }),
    ).toEqual({
      code: "invalid_reference",
      issues: [{ code: "reference_not_found", path: "/metadata/topicId" }],
    });
    expect(
      mapPostgresError({
        code: "23503",
        constraint: "materials_created_by_fk",
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

  test("keeps a system-owned slug constraint failure internal", () => {
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
      ),
    ).toMatchObject({ code: "internal_error" });
  });
});
