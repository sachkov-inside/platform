/**
 * Limits of a Glossary Term's text, after trim. The content package client checks them before any
 * write, so this file has no imports and only erasable TypeScript syntax: tooling imports it
 * directly with native type stripping.
 */
export const GLOSSARY_TERM_TITLE_MAX = 120;
export const GLOSSARY_SHORT_DEFINITION_MAX = 300;
export const GLOSSARY_FULL_DEFINITION_MAX = 4000;
/**
 * Most Glossary Terms one write may carry. A write upserts each term by id and never deletes a term
 * it omits, so the bound limits one request, not the Glossary.
 */
export const GLOSSARY_TERMS_MAX = 2000;
