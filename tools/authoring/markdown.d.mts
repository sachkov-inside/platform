interface DocNode {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: { href: string } }[];
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

/** Markdown import output is validated by the MaterialBody acceptance boundary. */
export function convertMarkdown(
  markdown: string,
  source: {
    sourcePath: string;
    sourceId: string;
    link: (href: string) => string;
    image: (src: string) => string;
    imageVariants?: (
      src: string,
    ) =>
      | {
          sourceSrc: string;
          imageVariants: import("@inside/material-blocks").ImageVariants<string>;
        }
      | undefined;
  },
): { schemaVersion: 1; doc: DocNode & { content: DocNode[] } };

export function sourceUuid(value: string): string;
