export {
  contentCoverSchema,
  contentCoverUrl,
  coverLinkPreviewImage,
  type ContentCover,
  materialPreviewHasVideo,
  type MaterialPreview,
  materialPreviewSchema,
  publishedMaterialProjectionSchema,
  toMaterialPreview,
  materialDifficultyLabel,
  materialTaxonomyLabel,
  calloutTones,
  type CalloutTone,
  type MaterialLabeledRow,
  renderedBlockSchema,
  renderedMarkSchema,
  renderedMaterialBodySchema,
  renderedTextSchema,
  type RenderedBlock,
  type RenderedMark,
  type RenderedMaterialBody,
  type RenderedText,
} from "../material.model";
export { MaterialCard, type MaterialCardProps } from "./ui/material-card";
export {
  calloutTonePresentation,
  MaterialAgentPrompt,
  MaterialCallout,
  MaterialKeyPoint,
  MaterialLessonBlock,
  type LessonBlock,
  type LessonBlockRendering,
  MaterialLabeledList,
  MaterialModeVariant,
  type MaterialModeBranch,
  MaterialResourceCard,
  MaterialTakeaways,
} from "./ui/material-blocks";
export { ContentCoverImage } from "./ui/content-cover-image.client";

export { MaterialReadingStatus, materialReadingLabels } from "./ui/material-reading-status";

export { MaterialReadingContext, useMaterialReading, type MaterialReadingSnapshot } from "./model/reading-context.client";
