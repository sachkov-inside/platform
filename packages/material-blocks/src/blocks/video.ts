import { z } from "zod";

import {
  defineMaterialBlock,
  type MaterialBlockDefinition,
} from "../block-definition.js";
import { nodeAttributes, optionalText } from "../document-node.js";
import { optionalTextIssue } from "./block-fields.js";
export const videoChaptersSchema: z.ZodType<
  { start: number; title: string }[]
> = z
  .array(
    z
      .object({
        start: z.number().int().nonnegative(),
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
  )
  .max(200)
  .refine(
    (chapters) =>
      chapters.every(
        (chapter, index) =>
          index === 0 || chapter.start > (chapters[index - 1]?.start ?? -1),
      ),
    "Video chapters must have increasing timestamps",
  );

/** Position and editorial context of the Material's primary Video; never a provider URL or ID. */
export const videoBlock: MaterialBlockDefinition = defineMaterialBlock<"video">(
  {
    type: "video",
    kind: "video",
    node: {
      atom: true,
      attributes: { description: null, chapters: null },
      domAttributes: {
        description: "data-video-description",
        chapters: "data-video-chapters",
      },
      draggable: true,
      group: "block",
      parseHTML: ['[data-material-block="video"]'],
      renderHTML: (attributes) => [
        "div",
        { ...attributes, "data-material-block": "video" },
        "Видео материала",
      ],
    },
    issues: (node, report) => {
      optionalTextIssue(
        node,
        report,
        "invalid_video_description",
        "description",
      );
      const chapters = nodeAttributes(node)["chapters"];
      if (
        chapters !== undefined &&
        chapters !== null &&
        !videoChaptersSchema.safeParse(chapters).success
      )
        report("invalid_video_chapters", "chapters");
    },
    render: (node) => {
      const attributes = nodeAttributes(node);
      const description = optionalText(attributes["description"]);
      const chapters = attributes["chapters"];
      return {
        kind: "video",
        ...(description === undefined ? {} : { description }),
        ...(chapters === undefined || chapters === null
          ? {}
          : { chapters: videoChaptersSchema.parse(chapters) }),
      };
    },
    renderedSchema: () =>
      z
        .object({
          kind: z.literal("video"),
          description: z.string().optional(),
          chapters: videoChaptersSchema.optional(),
        })
        .strict(),
    text: (block) =>
      [
        block.description,
        ...(block.chapters?.map((chapter) => chapter.title) ?? []),
      ]
        .filter(Boolean)
        .join("\n"),
  },
);
