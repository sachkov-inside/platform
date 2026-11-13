import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

import { authoringSourceIdSchema } from "../../../infrastructure/content-authoring/authoring-source.js";

export const GLOSSARY_TERM_TITLE_MAX = 120;
export const GLOSSARY_SHORT_DEFINITION_MAX = 300;
export const GLOSSARY_FULL_DEFINITION_MAX = 4000;
/** One write replaces the whole Glossary, so the bound covers every term at once. */
export const GLOSSARY_TERMS_MAX = 2000;

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * One Glossary Term as an authoring client writes it. Text is stored trimmed. The full definition
 * is plain text; a blank line separates its paragraphs. The introducing Material is named by its
 * authoring source identifier, `<sourceNamespace>:<material sourceId>`.
 */
export const glossaryTermSchema = z
  .object({
    id: glossaryTermIdSchema,
    title: text(GLOSSARY_TERM_TITLE_MAX),
    englishTitle: text(GLOSSARY_TERM_TITLE_MAX).nullable(),
    shortDefinition: text(GLOSSARY_SHORT_DEFINITION_MAX),
    fullDefinition: text(GLOSSARY_FULL_DEFINITION_MAX),
    introducedInSourceId: authoringSourceIdSchema.nullable(),
  })
  .strict();

export type GlossaryTerm = z.output<typeof glossaryTermSchema>;
