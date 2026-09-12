import { Node, getSchema } from "@tiptap/core";
import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import UniqueID from "@tiptap/extension-unique-id";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";

import type { MaterialBlockChildNodeDescription } from "./block-definition.js";
import {
  addressableMaterialBlockTypes,
  materialBlockDefinitions,
} from "./registry.js";
import { headingLevels } from "./rendered-block.js";

export interface MaterialDocumentExtensionOptions {
  /** Editor-side appearance for a declared block, keyed by its node type. */
  readonly nodeViews?: Readonly<Record<string, () => NodeViewRenderer>>;
}

/**
 * A field travels through the DOM as text. Anything that is not a string is JSON, so a row list
 * comes back as the same value it was written from.
 */
function encodeAttribute(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function decodeAttribute(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * `group` is what separates a block from the child nodes a block builds its content from: an
 * ungrouped node appears only where a content expression names it.
 */
function materialBlockNode(
  name: string,
  description: MaterialBlockChildNodeDescription,
  nodeView: (() => NodeViewRenderer) | undefined,
  group?: "block",
): Node {
  return Node.create({
    ...(description.atom === true ? { atom: true } : {}),
    ...(description.code === true ? { code: true } : {}),
    ...(description.content === undefined ? {} : { content: description.content }),
    ...(description.defining === true ? { defining: true } : {}),
    ...(description.draggable === true ? { draggable: true } : {}),
    ...(description.marks === undefined ? {} : { marks: description.marks }),
    ...(nodeView === undefined ? {} : { addNodeView: nodeView }),
    addAttributes() {
      return Object.fromEntries(
        Object.entries(description.attributes).map(([attribute, value]) => {
          const domAttribute = description.domAttributes?.[attribute];
          if (domAttribute === undefined) {
            return [attribute, { default: value }];
          }
          return [
            attribute,
            {
              default: value,
              // The package compiles without the DOM library, so the element is read through
              // the one method this rule needs.
              parseHTML: (element: { getAttribute: (name: string) => string | null }) =>
                decodeAttribute(element.getAttribute(domAttribute)),
              renderHTML: (attributes: Record<string, unknown>) => {
                const field = attributes[attribute];
                return field === null || field === undefined
                  ? {}
                  : { [domAttribute]: encodeAttribute(field) };
              },
            },
          ];
        }),
      );
    },
    ...(group === undefined ? {} : { group }),
    name,
    parseHTML() {
      return description.parseHTML.map((tag) => ({
        tag,
        ...(description.parseContent === undefined
          ? {}
          : { contentElement: description.parseContent }),
        ...(description.preserveWhitespace === undefined
          ? {}
          : { preserveWhitespace: description.preserveWhitespace }),
      }));
    },
    renderHTML({ HTMLAttributes }) {
      return description.renderHTML(HTMLAttributes);
    },
  });
}

/**
 * The document schema both the server and the editor build from. Every node comes from the
 * registry or from a configured Tiptap kit, so the two sides cannot drift apart.
 */
export function materialDocumentExtensions(
  options: MaterialDocumentExtensionOptions = {},
): Extensions {
  return [
    StarterKit.configure({
      hardBreak: false,
      heading: { levels: headingLevels },
      link: { HTMLAttributes: { rel: null, target: null }, openOnClick: false },
      underline: false,
    }),
    TableKit,
    UniqueID.configure({
      attributeName: "nodeId",
      types: [...addressableMaterialBlockTypes],
    }),
    ...materialBlockDefinitions.flatMap((definition) => {
      const declaration = definition.node;
      return declaration === undefined
        ? []
        : [
            materialBlockNode(
              definition.type,
              declaration,
              options.nodeViews?.[definition.type],
              "block",
            ),
            ...Object.entries(declaration.childNodes ?? {}).map(([name, child]) =>
              materialBlockNode(name, child, options.nodeViews?.[name]),
            ),
          ];
    }),
  ];
}

export const materialDocumentSchemaV1: Schema = getSchema(
  materialDocumentExtensions(),
);

/**
 * Tiptap publishes its editor commands by augmenting `@tiptap/core`. An editor built from these
 * extensions needs those declarations in its own TypeScript program, so the kits this schema
 * configures stay reachable through the entry point that owns them.
 */
export type { StarterKitOptions } from "@tiptap/starter-kit";
export type { TableKitOptions } from "@tiptap/extension-table";
export type { UniqueIDOptions } from "@tiptap/extension-unique-id";
