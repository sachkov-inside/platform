import { Node, getSchema } from "@tiptap/core";
import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import UniqueID from "@tiptap/extension-unique-id";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";

import type { MaterialBlockNodeDescription } from "./block-definition.js";
import {
  addressableMaterialBlockTypes,
  materialBlockDefinitions,
} from "./registry.js";
import { headingLevels } from "./rendered-block.js";

export interface MaterialDocumentExtensionOptions {
  /** Editor-side appearance for a declared block, keyed by its node type. */
  readonly nodeViews?: Readonly<Record<string, () => NodeViewRenderer>>;
}

function materialBlockNode(
  name: string,
  description: MaterialBlockNodeDescription,
  nodeView: (() => NodeViewRenderer) | undefined,
): Node {
  return Node.create({
    ...(description.atom === true ? { atom: true } : {}),
    ...(description.content === undefined ? {} : { content: description.content }),
    ...(description.defining === true ? { defining: true } : {}),
    ...(description.draggable === true ? { draggable: true } : {}),
    ...(nodeView === undefined ? {} : { addNodeView: nodeView }),
    addAttributes() {
      return Object.fromEntries(
        Object.entries(description.attributes).map(([attribute, value]) => [
          attribute,
          { default: value },
        ]),
      );
    },
    group: description.group,
    name,
    parseHTML() {
      return description.parseHTML.map((tag) => ({ tag }));
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
    ...materialBlockDefinitions.flatMap((definition) =>
      definition.node === undefined
        ? []
        : [
            materialBlockNode(
              definition.type,
              definition.node,
              options.nodeViews?.[definition.type],
            ),
          ],
    ),
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
