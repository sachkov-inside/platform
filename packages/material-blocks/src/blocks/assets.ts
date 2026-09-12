import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectString, nodeAttributes, optionalText } from "../document-node.js";
import type { MaterialBlockNodeDescription } from "../block-definition.js";
import { isJsonObject, stringAttribute } from "../json.js";

/** Field rules, declared once and read both by the document node and by the rendered block. */
const assetIdSchema = z.uuid();
const displayWidthPercentSchema = z.number().int().min(25).max(100);

function accepts(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse(value).success;
}

function attributeText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function assetNode(
  name: "assetFile" | "assetImage",
  attributes: readonly string[],
): MaterialBlockNodeDescription {
  return {
    atom: true,
    attributes: Object.fromEntries(attributes.map((attribute) => [attribute, null])),
    draggable: true,
    group: "block",
    // One DOM contract for both applications: the editor's, because the server never parses or
    // renders HTML and the editor's clipboard behaviour must not change.
    parseHTML: [`[data-material-asset="${name}"]`],
    renderHTML: (nodeAttributes) => {
      const isImage = name === "assetImage";
      const label = isImage
        ? attributeText(nodeAttributes.alt, "Декоративное изображение")
        : attributeText(nodeAttributes.label, "Файл");
      return [
        isImage ? "figure" : "div",
        {
          ...nodeAttributes,
          class: "material-asset-node",
          "data-material-asset": name,
        },
        ["span", { class: "material-asset-node__kind" }, isImage ? "Изображение" : "Файл"],
        ["span", { class: "material-asset-node__label" }, label],
      ];
    },
  };
}

export const assetImageBlock = defineMaterialBlock<"image">({
  issues: (node, report) => {
    const attributes = isJsonObject(node.attrs) ? node.attrs : undefined;
    const displayWidthPercent = attributes?.displayWidthPercent;
    if (
      displayWidthPercent !== undefined &&
      displayWidthPercent !== null &&
      !accepts(displayWidthPercentSchema, displayWidthPercent)
    ) {
      report("invalid_image_size", "displayWidthPercent");
    }
    if (!accepts(assetIdSchema, stringAttribute(node, "assetId"))) {
      report("invalid_asset_id", "assetId");
    }
    if (stringAttribute(node, "alt") === undefined) {
      report("missing_image_alt", "alt");
    }
  },
  kind: "image",
  node: assetNode("assetImage", ["assetId", "alt", "caption", "displayWidthPercent"]),
  render: (node) => {
    const attributes = nodeAttributes(node);
    const caption = optionalText(attributes.caption);
    return {
      alt: expectString(attributes.alt, "image alt"),
      assetId: expectString(attributes.assetId, "asset ID"),
      ...(caption === undefined ? {} : { caption }),
      ...(typeof attributes.displayWidthPercent === "number"
        ? { displayWidthPercent: attributes.displayWidthPercent }
        : {}),
      kind: "image",
    };
  },
  renderedSchema: () =>
    z
      .object({
        alt: z.string(),
        assetId: assetIdSchema,
        caption: z.string().optional(),
        displayWidthPercent: displayWidthPercentSchema.optional(),
        height: z.number().int().positive().optional(),
        kind: z.literal("image"),
        variants: z
          .array(
            z
              .object({
                height: z.number().int().positive(),
                width: z.number().int().positive(),
              })
              .strict(),
          )
          .optional(),
        width: z.number().int().positive().optional(),
      })
      .strict(),
  resource: (block) => ({
    alt: block.alt,
    assetId: block.assetId,
    ...(block.caption === undefined ? {} : { caption: block.caption }),
    kind: "image",
  }),
  text: (block) => [block.alt, block.caption].filter(Boolean).join("\n"),
  type: "assetImage",
});

export const assetFileBlock = defineMaterialBlock<"file">({
  issues: (node, report) => {
    if (!accepts(assetIdSchema, stringAttribute(node, "assetId"))) {
      report("invalid_asset_id", "assetId");
    }
    const label = stringAttribute(node, "label");
    if (label === undefined || label.trim().length === 0) {
      report("missing_file_label", "label");
    }
  },
  kind: "file",
  node: assetNode("assetFile", ["assetId", "label"]),
  render: (node) => {
    const attributes = nodeAttributes(node);
    return {
      assetId: expectString(attributes.assetId, "asset ID"),
      kind: "file",
      label: expectString(attributes.label, "file label"),
    };
  },
  renderedSchema: () =>
    z
      .object({
        assetId: assetIdSchema,
        contentType: z.string().optional(),
        filename: z.string().optional(),
        kind: z.literal("file"),
        label: z.string(),
        size: z.number().int().nonnegative().optional(),
      })
      .strict(),
  resource: (block) => ({ assetId: block.assetId, kind: "file", label: block.label }),
  text: (block) => block.label,
  type: "assetFile",
});
