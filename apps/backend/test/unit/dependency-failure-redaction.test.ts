import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { dependencyFailure } from "../../src/infrastructure/observability/index.js";

const scope = { module: "billing", operation: "purchase" };

function reported(error: unknown, variant: unknown = { ok: false, error: { code: "dependency_unavailable" } }) {
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  lines.mockClear();
  expect(dependencyFailure(scope, error, variant)).toBe(variant);
  expect(lines).toHaveBeenCalledOnce();
  const line = String(lines.mock.calls[0]?.[0]);
  return { line, record: z.record(z.string(), z.unknown()).parse(JSON.parse(line)) };
}

describe("dependency failure redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the cause readable while removing secrets and personal data from its text", () => {
    const failure = new Error(
      "connect to postgresql://inside:db-secret@db.internal:5432/inside failed for member@example.com; " +
        "retry https://storage.example/bucket/key?X-Amz-Signature=sig-secret with Bearer tok-secret, " +
        "token=raw-secret, jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl, phone +7 912 345-67-89, card 4111 1111 1111 1111",
    );

    const { line, record } = reported(failure);

    expect(record).toMatchObject({ event: "dependency_failure", module: "billing", operation: "purchase" });
    for (const secret of [
      "db-secret",
      "member@example.com",
      "sig-secret",
      "tok-secret",
      "raw-secret",
      "eyJhbGciOiJIUzI1NiJ9",
      "345-67-89",
      "4111 1111",
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain("postgresql://[redacted]@db.internal:5432/inside");
    expect(line).toContain("https://storage.example/bucket/key?[redacted]");
  });

  it("records only the name and code of errors whose text restates the query or its input", () => {
    const prismaFailure = Object.assign(new Error("Invalid `prisma.billingContact.create()` invocation: { email: \"member@example.com\" }"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    const parseFailure = new SyntaxError("Unexpected token in JSON at position 3: {\"phone\":\"secret\"}");
    const postgresFailure = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Key (email)=(member@example.com) already exists.",
    });

    const prisma = reported(prismaFailure).record.error;
    expect(prisma).toMatchObject({ type: "PrismaClientKnownRequestError", code: "P2002" });
    expect(prisma).not.toHaveProperty("message");
    const parse = reported(parseFailure).record.error;
    expect(parse).toMatchObject({ type: "SyntaxError" });
    expect(parse).not.toHaveProperty("message");
    const postgres = reported(postgresFailure);
    expect(postgres.record.error).toMatchObject({ type: "Error", code: "23505", message: "duplicate key value violates unique constraint" });
    expect(postgres.line).not.toContain("member@example.com");
  });

  it("links the answer the caller got to the record", () => {
    const { record } = reported(new Error("socket closed"), {
      ok: false,
      error: { code: "internal_error", correlationId: "7b1e0c1e-4a57-4a57-9a57-0a57a57a57a5" },
    });

    expect(record).toMatchObject({
      outcome: "internal_error",
      correlationId: "7b1e0c1e-4a57-4a57-9a57-0a57a57a57a5",
      error: { type: "Error", message: "socket closed" },
    });
  });
});
