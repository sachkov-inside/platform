import "server-only";

import { z } from "zod";

import {
  requestGlossaryTermMarks,
  requestSetGlossaryTermMark,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { termMarkSchema } from "../model/term-mark-contract";
import {
  getTermMarksOperation,
  setTermMarkOperation,
} from "./term-marks.operation";

export function handleTermMarks(request: Request) {
  return handleMutationOperation(request, getTermMarksOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestGlossaryTermMarks(input.termIds, token);
        if (!result.ok)
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        const parsed = z
          .object({ marks: z.array(termMarkSchema).max(100) })
          .strict()
          .safeParse(result.body);
        return parsed.success
          ? { kind: "ready", marks: parsed.data.marks }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}

export function handleSetTermMark(request: Request) {
  return handleMutationOperation(request, setTermMarkOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestSetGlossaryTermMark(input, token);
        if (!result.ok)
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        const mark = termMarkSchema.safeParse(result.body);
        return mark.success
          ? { kind: "ready", mark: mark.data }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
