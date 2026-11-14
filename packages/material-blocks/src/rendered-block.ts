import { z } from "zod";

export type RenderedMark =
  | { readonly kind: "bold" | "code" | "italic" | "strike" }
  | { readonly href: string; readonly kind: "link" };

export interface RenderedText {
  readonly kind: "text";
  readonly marks: readonly RenderedMark[];
  readonly text: string;
}

export type HeadingLevel = 2 | 3 | 4;

/** One term of a labeled list: a short label, the term it marks and an optional explanation. */
export interface MaterialLabeledRow {
  readonly description?: string | undefined;
  readonly label: string;
  readonly name: string;
}

/**
 * A rendered block is recursive, so TypeScript cannot infer this union from the registry's
 * schemas: the schemas need the type to describe their own nested content. The two stay in step
 * because `defineMaterialBlock` accepts only a `kind` this union declares, and the wire
 * enumeration is built from the registry rather than from a second list.
 */
export interface ImageVariants<T> {
  readonly wideLight: T;
  readonly wideDark: T;
  readonly tallLight: T;
  readonly tallDark: T;
}

/**
 * `format: "svg"` marks an image whose file is a checked SVG (#2041): Reader puts its markup into
 * the page instead of an `<img>`. A raster image has no `format`.
 */
export type ImageFormat = "svg";

export interface ImageAssetPresentation {
  readonly assetId: string;
  readonly format?: ImageFormat | undefined;
  readonly height?: number | undefined;
  readonly width?: number | undefined;
  readonly variants?:
    readonly { readonly height: number; readonly width: number }[] | undefined;
}

type RenderedRich = readonly RenderedBlock[];

/** Fields every Lesson Exercise shares. `context` and `question` are what search sees. */
interface RenderedExerciseCommon {
  readonly id: string;
  readonly reveal: "none" | "after-answer";
  readonly context?: RenderedRich | undefined;
  readonly question: RenderedRich;
  readonly dontKnow?:
    | {
        readonly explanation: RenderedRich;
        readonly reviewLinks: readonly string[];
      }
    | undefined;
}

export interface RenderedQuiz extends RenderedExerciseCommon {
  readonly kind: "quiz";
  readonly selectionMode: "single" | "multiple";
  readonly options: readonly {
    readonly id: string;
    readonly content: RenderedRich;
    readonly correct: boolean;
    readonly explanation?: RenderedRich | undefined;
  }[];
}

export interface RenderedMatch extends RenderedExerciseCommon {
  readonly kind: "match";
  readonly mode: "pairs" | "groups";
  readonly rows: readonly {
    readonly id: string;
    readonly content: RenderedRich;
    readonly answerId: string;
    readonly explanation: RenderedRich;
  }[];
  readonly choices: readonly {
    readonly id: string;
    readonly content: RenderedRich;
  }[];
}

/** `steps` are stored in the correct order; the reader shuffles them. */
export interface RenderedOrder extends RenderedExerciseCommon {
  readonly kind: "order";
  readonly steps: readonly {
    readonly id: string;
    readonly content: RenderedRich;
    readonly explanation: RenderedRich;
  }[];
}

export type RenderedExercise = RenderedQuiz | RenderedMatch | RenderedOrder;

export type RenderedBlock =
  | RenderedExercise
  /** A Lesson Step Break: the next part opens by a button with this label (#2122). */
  | { readonly kind: "step_break"; readonly label: string }
  | {
      readonly kind: "video";
      readonly description?: string | undefined;
      readonly chapters?:
        | readonly { readonly start: number; readonly title: string }[]
        | undefined;
    }
  | { readonly content: readonly RenderedText[]; readonly kind: "paragraph" }
  | {
      readonly content: readonly RenderedText[];
      readonly kind: "heading";
      readonly level: HeadingLevel;
    }
  | {
      readonly items: readonly (readonly RenderedBlock[])[];
      readonly kind: "bullet_list";
    }
  | {
      readonly items: readonly (readonly RenderedBlock[])[];
      readonly kind: "ordered_list";
      readonly start?: number | undefined;
    }
  | { readonly content: readonly RenderedBlock[]; readonly kind: "blockquote" }
  | {
      readonly kind: "code_block";
      /** Fence language as the author wrote it, such as `python`. */
      readonly language?: string | undefined;
      readonly text: string;
    }
  | { readonly kind: "horizontal_rule" }
  | {
      readonly kind: "table";
      readonly rows: readonly {
        readonly cells: readonly {
          readonly content: readonly RenderedBlock[];
          readonly header: boolean;
        }[];
      }[];
    }
  | {
      readonly content: readonly RenderedBlock[];
      readonly kind: "callout";
      readonly collapse?: "collapsed" | "expanded" | undefined;
      readonly title?: string | undefined;
      readonly tone:
        | "bad"
        | "definition"
        | "example"
        | "good"
        | "note"
        | "task"
        | "tip"
        | "warning";
    }
  | {
      readonly description?: string | undefined;
      readonly kind: "resource_card";
      readonly title: string;
      readonly url: string;
    }
  | {
      readonly kind: "agent_prompt";
      readonly text: string;
      readonly title?: string | undefined;
    }
  | {
      readonly content: readonly RenderedBlock[];
      readonly kind: "takeaways";
      readonly title: string;
    }
  | {
      readonly kind: "labeled_list";
      readonly rows: readonly MaterialLabeledRow[];
    }
  | { readonly content: readonly RenderedText[]; readonly kind: "key_point" }
  /** A definition card: the reader shows the term's full definition from the Glossary. */
  | { readonly kind: "term_definition"; readonly termId: string }
  | {
      readonly alt: string;
      readonly assetId: string;
      readonly caption?: string | undefined;
      readonly displayWidthPercent?: number | undefined;
      readonly format?: ImageFormat | undefined;
      readonly height?: number | undefined;
      readonly kind: "image";
      readonly sourceSrc?: string | undefined;
      readonly imageVariants?:
        ImageVariants<ImageAssetPresentation> | undefined;
      readonly variants?:
        | readonly { readonly height: number; readonly width: number }[]
        | undefined;
      readonly width?: number | undefined;
    }
  | {
      readonly assetId: string;
      readonly contentType?: string | undefined;
      readonly filename?: string | undefined;
      readonly kind: "file";
      readonly label: string;
      readonly size?: number | undefined;
    };

export type RenderedBlockKind = RenderedBlock["kind"];

export interface RenderedMaterialBody {
  readonly blocks: readonly RenderedBlock[];
  readonly schemaVersion: 1;
}

export interface MaterialBodyHeading {
  readonly level: HeadingLevel;
  readonly text: string;
}

export type MaterialBodyResourceSummary =
  | {
      readonly alt: string;
      readonly assetId: string;
      readonly caption?: string | undefined;
      readonly kind: "image";
    }
  | { readonly assetId: string; readonly kind: "file"; readonly label: string };

export const renderedMarkSchema: z.ZodType<RenderedMark> = z.union([
  z.object({ kind: z.enum(["bold", "code", "italic", "strike"]) }).strict(),
  z.object({ href: z.string(), kind: z.literal("link") }).strict(),
]);

export const renderedTextSchema: z.ZodType<RenderedText> = z
  .object({
    kind: z.literal("text"),
    marks: z.array(renderedMarkSchema),
    text: z.string(),
  })
  .strict();

const headingLevelSchemas: readonly [
  z.ZodLiteral<2>,
  z.ZodLiteral<3>,
  z.ZodLiteral<4>,
] = [z.literal(2), z.literal(3), z.literal(4)];

export const headingLevelSchema: z.ZodUnion<typeof headingLevelSchemas> =
  z.union(headingLevelSchemas);

/** Text a run of inline content carries, without its marks. */
export function inlineText(content: readonly RenderedText[]): string {
  return content.map(({ text }) => text).join("");
}

/** Material headings start at the second level: the material title owns the first. */
export const headingLevels: HeadingLevel[] = headingLevelSchemas.map(
  (schema) => schema.value,
);

export function isHeadingLevel(value: unknown): value is HeadingLevel {
  return headingLevelSchema.safeParse(value).success;
}
