import { expect, test } from "vitest";
import { classifyFailure } from "../../src/infrastructure/observability/failure-cause.js";

test("failure causes retain only finite driver codes through bounded cause wrappers", () => {
  expect(
    classifyFailure(
      Object.assign(new Error("private-query"), { code: "23505" }),
    ),
  ).toEqual({ category: "constraint", code: "23505" });
  expect(
    classifyFailure({
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: { originalCode: "57014", message: "private-query" },
        },
      },
    }),
  ).toEqual({ category: "timeout", code: "57014" });
  expect(
    classifyFailure({
      errors: [{ code: "ECONNREFUSED", address: "private-host" }],
    }),
  ).toEqual({ category: "connection", code: "ECONNREFUSED" });
  expect(
    classifyFailure({ code: "P2002", meta: { target: ["private-email"] } }),
  ).toEqual({ category: "constraint", code: "P2002" });
});

test("failure causes never execute getters or retain arbitrary error fields", () => {
  let reads = 0;
  const hostile = {
    get code() {
      reads += 1;
      throw new Error("private-getter");
    },
    message: "private-email",
  };
  expect(classifyFailure(hostile)).toEqual({
    category: "unknown",
    code: "unknown",
  });
  expect(reads).toBe(0);
  const cycle: { cause?: unknown; code: string } = { code: "private-code" };
  cycle.cause = cycle;
  expect(classifyFailure(cycle)).toEqual({
    category: "unknown",
    code: "unknown",
  });
  expect(
    classifyFailure(
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error("private-proxy");
          },
        },
      ),
    ),
  ).toEqual({ category: "unknown", code: "unknown" });
  expect(
    classifyFailure({
      cause: { cause: { cause: { cause: { cause: { code: "23505" } } } } },
    }),
  ).toEqual({ category: "unknown", code: "unknown" });
});
