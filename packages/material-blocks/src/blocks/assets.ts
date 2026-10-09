import { z } from "zod";

import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
  type MaterialBlockNodeDescription,
} from "../block-definition.js";
import {
  expectString,
  nodeAttributes,
  optionalText,
} from "../document-node.js";
import { isJsonObject, stringAttribute } from "../json.js";

/** Field rules, declared once and read both by the document node and by the rendered block. */
const assetIdSchema = z.uuid();
const imageVariantIdsSchema = z
  .object({
    wideLight: assetIdSchema,
    wideDark: assetIdSchema,
    tallLight: assetIdSchema,
    tallDark: assetIdSchema,
  })
  .strict();
const imagePresentationSchema = z
  .object({
    assetId: assetIdSchema,
    height: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
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
  })
  .strict();
const imageVariantsSchema = z
  .object({
    wideLight: imagePresentationSchema,
    wideDark: imagePresentationSchema,
    tallLight: imagePresentationSchema,
    tallDark: imagePresentationSchema,
  })
  .strict();
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
    attributes: Object.fromEntries(
      attributes.map((attribute) => [attribute, null]),
    ),
    draggable: true,
    group: "block",
    // One DOM contract for both applications: the editor's, because the server never parses or
    // renders HTML and the editor's clipboard behaviour must not change.
    domAttributes:
      name === "assetImage"
        ? { imageVariants: "data-image-variants", sourceSrc: "data-source-src" }
        : {},
    parseHTML: [`[data-material-asset="${name}"]`],
    renderHTML: (nodeAttributes) => {
      const isImage = name === "assetImage";
      const label = isImage
        ? attributeText(nodeAttributes["alt"], "Декоративное изображение")
        : attributeText(nodeAttributes["label"], "Файл");
      return [
        isImage ? "figure" : "div",
        {
          ...nodeAttributes,
          class: "material-asset-node",
          "data-material-asset": name,
        },
        [
          "span",
          { class: "material-asset-node__kind" },
          isImage ? "Изображение" : "Файл",
        ],
        ["span", { class: "material-asset-node__label" }, label],
      ];
    },
  };
}

export const assetImageBlock: MaterialBlockDefinition =
  defineMaterialBlock<"image">({
    issues: (node, report) => {
      const attributes = isJsonObject(node["attrs"])
        ? node["attrs"]
        : undefined;
      const imageVariants = attributes?.["imageVariants"];
      if (imageVariants !== undefined && imageVariants !== null) {
        const parsed = imageVariantIdsSchema.safeParse(imageVariants);
        if (
          !parsed.success ||
          !Object.values(parsed.data).includes(
            stringAttribute(node, "assetId") ?? "",
          )
        )
          report("invalid_image_variants", "imageVariants");
        if (
          typeof attributes?.["sourceSrc"] !== "string" ||
          attributes["sourceSrc"].length === 0
        )
          report("missing_image_source", "sourceSrc");
      }
      const displayWidthPercent = attributes?.["displayWidthPercent"];
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
    node: assetNode("assetImage", [
      "assetId",
      "alt",
      "caption",
      "displayWidthPercent",
      "sourceSrc",
      "imageVariants",
    ]),
    render: (node) => {
      const attributes = nodeAttributes(node);
      const caption = optionalText(attributes["caption"]);
      const sourceSrc = optionalText(attributes["sourceSrc"]);
      const ids =
        attributes["imageVariants"] == null
          ? undefined
          : imageVariantIdsSchema.parse(attributes["imageVariants"]);
      return {
        alt: expectString(attributes["alt"], "image alt"),
        assetId: expectString(attributes["assetId"], "asset ID"),
        ...(caption === undefined ? {} : { caption }),
        ...(typeof attributes["displayWidthPercent"] === "number"
          ? { displayWidthPercent: attributes["displayWidthPercent"] }
          : {}),
        ...(sourceSrc === undefined ? {} : { sourceSrc }),
        ...(ids === undefined
          ? {}
          : {
              imageVariants: {
                wideLight: { assetId: ids.wideLight },
                wideDark: { assetId: ids.wideDark },
                tallLight: { assetId: ids.tallLight },
                tallDark: { assetId: ids.tallDark },
              },
            }),
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
          sourceSrc: z.string().optional(),
          imageVariants: imageVariantsSchema.optional(),
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

export const assetFileBlock: MaterialBlockDefinition =
  defineMaterialBlock<"file">({
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
        assetId: expectString(attributes["assetId"], "asset ID"),
        kind: "file",
        label: expectString(attributes["label"], "file label"),
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
    resource: (block) => ({
      assetId: block.assetId,
      kind: "file",
      label: block.label,
    }),
    text: (block) => block.label,
    type: "assetFile",
  });
