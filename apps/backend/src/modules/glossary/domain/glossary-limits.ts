/**
 * Limits of a Glossary Term's text, after trim. The content package client checks them before any
 * write, so this file has no imports and only erasable TypeScript syntax: tooling imports it
 * directly with native type stripping.
 */
export const GLOSSARY_TERM_TITLE_MAX = 120;
export const GLOSSARY_SHORT_DEFINITION_MAX = 300;
export const GLOSSARY_FULL_DEFINITION_MAX = 4000;
/** One write replaces the whole Glossary, so the bound covers every term at once. */
export const GLOSSARY_TERMS_MAX = 2000;
