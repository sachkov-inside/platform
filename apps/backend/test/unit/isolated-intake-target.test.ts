import { expect, test } from "vitest";
import { createIsolatedProductIntake } from "../../src/development/create-isolated-product-intake.js";

test.each([
  {
    name: "non-PostgreSQL",
    url: "http://127.0.0.1:9/inside_light_0123456789",
    message: "owned loopback PostgreSQL database",
  },
  {
    name: "external",
    url: "postgresql://inside:inside@must-not-connect.invalid/inside_light_0123456789",
    message: "owned loopback PostgreSQL database",
  },
  {
    name: "ordinary database",
    url: "postgresql://inside:inside@127.0.0.1:9/inside",
    message: "isolated database",
  },
])(
  "the trusted Intake composition refuses $name before assembling persistence",
  async ({ url, message }) => {
    await expect(
      createIsolatedProductIntake({
        databaseUrl: url,
        productId: "97000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(message);
  },
);
