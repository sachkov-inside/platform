import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

export const materialDocumentSchema = z.custom<JSONContent>(
  (value) => isJsonContent(value) && value.type === "doc",
);

function isJsonContent(value: unknown): value is JSONContent {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const type = "type" in value ? value.type : undefined;
  const text = "text" in value ? value.text : undefined;
  const content = "content" in value ? value.content : undefined;
  return (
    (type === undefined || typeof type === "string") &&
    (text === undefined || typeof text === "string") &&
    (content === undefined ||
      (Array.isArray(content) &&
        content.length <= 10_000 &&
        content.every(isJsonContent)))
  );
}
