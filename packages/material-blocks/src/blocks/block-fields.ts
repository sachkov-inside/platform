import { z } from "zod";

import type { MaterialBlockIssueReport } from "../block-definition.js";
import type { JsonObject } from "../json.js";
import { isJsonObject } from "../json.js";

/** Rendered shape of a field the author may leave unset. */
export const titleAttributeSchema = z.string().optional();

/** Text a rendered DOM attribute carries; anything else is printed as nothing. */
export function attributeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function attributeValue(node: JsonObject, name: string): unknown {
  const attributes = node.attrs;
  return isJsonObject(attributes) ? attributes[name] : undefined;
}

/**
 * An optional text field is absent, `null` or a string. Anything else is a defect in the writing
 * client rather than an authoring mistake, so it fails closed with the block's own code.
 */
export function optionalTextIssue(
  node: JsonObject,
  report: MaterialBlockIssueReport,
  code: string,
  name = "title",
): void {
  const value = attributeValue(node, name);
  if (value !== undefined && value !== null && typeof value !== "string") {
    report(code, name);
  }
}

/**
 * A required text field is present as a string. It may still be empty: the author fills a freshly
 * inserted block after inserting it, and autosave must not reject that draft.
 */
export function requiredTextIssue(
  node: JsonObject,
  report: MaterialBlockIssueReport,
  code: string,
  name: string,
): void {
  if (typeof attributeValue(node, name) !== "string") {
    report(code, name);
  }
}
