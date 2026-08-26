import { z } from "zod";

export const dependencyUnavailableProblemSchema = z
  .object({
    type: z.literal("urn:inside:problem:dependency-unavailable"),
    title: z.literal("Dependency unavailable"),
    status: z.literal(503),
    code: z.literal("dependency_unavailable"),
    retryable: z.boolean(),
  })
  .strict();
