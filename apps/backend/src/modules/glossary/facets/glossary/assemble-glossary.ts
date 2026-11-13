import {
  listGlossaryTerms,
  lookupGlossaryTerms,
} from "../../features/read-glossary-terms/read-glossary-terms.js";
import { upsertGlossaryTerms } from "../../features/upsert-glossary-terms/upsert-glossary-terms.js";
import type { GlossaryOperationDependencies } from "../../shared/glossary-dependencies.js";
import type { Glossary } from "./glossary.js";

export function assembleGlossary(
  dependencies: GlossaryOperationDependencies,
): Glossary {
  const glossary: Glossary = {
    upsert: (command) => upsertGlossaryTerms(dependencies, command),
    list: (query) => listGlossaryTerms(dependencies, query),
    lookup: (ids) => lookupGlossaryTerms(dependencies, ids),
  };
  return Object.freeze(glossary);
}
