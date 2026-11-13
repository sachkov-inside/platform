import {
  listGlossaryTerms,
  lookupGlossaryTerms,
} from "../../features/read-glossary-terms/read-glossary-terms.js";
import { replaceGlossary } from "../../features/replace-glossary/replace-glossary.js";
import type { GlossaryOperationDependencies } from "../../shared/glossary-dependencies.js";
import type { Glossary } from "./glossary.js";

export function assembleGlossary(
  dependencies: GlossaryOperationDependencies,
): Glossary {
  const glossary: Glossary = {
    replace: (command) => replaceGlossary(dependencies, command),
    list: (query) => listGlossaryTerms(dependencies, query),
    lookup: (ids) => lookupGlossaryTerms(dependencies, ids),
  };
  return Object.freeze(glossary);
}
