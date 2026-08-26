import { z } from "zod";

export const accountResponseSchema = z.object({
  account: z.object({
    accountId: z.uuid(),
  }),
});

export const accountProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: z.string(),
  correlationId: z.string().optional(),
});
