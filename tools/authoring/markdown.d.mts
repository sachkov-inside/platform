interface ImageVariantResolution {
  sourceSrc: string;
  imageVariants: import("@inside/material-blocks").ImageVariants<string>;
}

interface DocNode {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: { href: string } | { termId: string } }[];
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

/** Markdown import output is validated by the MaterialBody acceptance boundary. */
export function convertMarkdown(
  markdown: string,
  source: {
    sourcePath: string;
    sourceId: string;
    readerBlocks?:
      | readonly import("@inside/material-blocks").ContentReaderBlock[]
      | undefined;
    link: (href: string) => string;
    image: (src: string) => string;
    term?:
      | ((target: string) => import("./term-references.mjs").TermReference)
      | undefined;
    imageVariants?: (src: string) => ImageVariantResolution | undefined;
  },
): { schemaVersion: 1; doc: DocNode & { content: DocNode[] } };

export function sourceUuid(value: string): string;
