import { z } from "zod";
import { commerceScenario } from "../../../../scenarios/commerce.mjs";
import { assembleProductIntakeCreation } from "../entrypoints/composition/assemble-product-intake-creation.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";

/** Trusted local composition; it cannot target an ordinary application database. */
export async function createIsolatedProductIntake(input: {
  readonly databaseUrl: string;
  readonly productId: string;
}): Promise<void> {
  const expectedDatabase = new URL(input.databaseUrl).pathname.slice(1);
  if (
    !/^inside_(?:light_[a-f0-9]{10}|test_[a-f0-9]{32})$/u.test(expectedDatabase)
  )
    throw new Error("Product Intake scenario requires an isolated database");
  const productId = z.uuid().parse(input.productId);
  const prisma = createPrismaClient(input.databaseUrl);
  try {
    const actual = z
      .array(z.object({ name: z.string() }))
      .length(1)
      .parse(await prisma.$queryRaw`select current_database() as name`);
    if (actual[0]?.name !== expectedDatabase)
      throw new Error("Product Intake scenario database identity mismatch");
    const result = await assembleProductIntakeCreation({ prisma })({
      intakeId: commerceScenario.waitlist.intakeId,
      productId,
      name: commerceScenario.waitlist.name,
      accepting: commerceScenario.waitlist.accepting,
    });
    if (!result.ok)
      throw new Error(`Product Intake scenario failed: ${result.error.code}`);
  } finally {
    await prisma.$disconnect();
  }
}
