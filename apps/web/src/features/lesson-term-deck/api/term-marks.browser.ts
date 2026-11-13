import { queryOptions } from "@tanstack/react-query";

import type { TermMarkCommand } from "../model/term-mark-contract";
import {
  getTermMarksOperation,
  setTermMarkOperation,
} from "./term-marks.operation";

/** Отметки личные, поэтому у гостя запрос выключен, а не отбит отказом 401. */
export function termMarksQueryOptions(input: {
  readonly accountId: string | null;
  readonly termIds: readonly string[];
}) {
  return queryOptions({
    queryKey: ["glossary-marks", input.accountId, ...input.termIds],
    queryFn: () => getTermMarksOperation.send({ termIds: [...input.termIds] }),
    enabled: input.accountId !== null && input.termIds.length > 0,
    retry: false,
  });
}

export function setTermMark(input: TermMarkCommand) {
  return setTermMarkOperation.send(input);
}
