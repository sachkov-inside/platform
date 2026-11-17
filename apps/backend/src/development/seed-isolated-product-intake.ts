import { z } from "zod";
import { createIsolatedProductIntake } from "./create-isolated-product-intake.js";

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] !== "development")
    throw new Error(
      "The isolated Product Intake seed requires NODE_ENV=development",
    );
  const [productId] = z.tuple([z.uuid()]).parse(process.argv.slice(2));
  await createIsolatedProductIntake({
    databaseUrl: z.url().parse(process.env["DATABASE_URL"]),
    productId,
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
