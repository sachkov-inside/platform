export {
  calloutToneLabels,
  calloutTones,
  type CalloutTone,
} from "./blocks/callout.js";
export type {
  MaterialBlockDefinition,
  MaterialBlockIssueReport,
  MaterialBlockNodeDescription,
  MaterialBlockRenderTools,
  MaterialBlockTextTools,
  RenderedBlockVariantSchema,
} from "./block-definition.js";
export {
  mapMaterialBlockChildren,
  materialBlockChildren,
  materialBlockHeading,
  materialBlockResources,
  materialBlockText,
} from "./extract.js";
export type { JsonObject, JsonPrimitive, JsonValue } from "./json.js";
export {
  isJsonArray,
  isJsonObject,
  isUnknownArray,
  isUnknownRecord,
  stringAttribute,
} from "./json.js";
export {
  addressableMaterialBlockTypes,
  materialBlockByKind,
  materialBlockByType,
  materialBlockDefinitions,
} from "./registry.js";
export { renderMaterialBlock, renderMaterialBlocks } from "./render.js";
export type {
  HeadingLevel,
  MaterialBodyHeading,
  MaterialBodyResourceSummary,
  MaterialLabeledRow,
  RenderedBlock,
  RenderedBlockKind,
  RenderedMark,
  RenderedMaterialBody,
  RenderedText,
} from "./rendered-block.js";
export {
  headingLevels,
  headingLevelSchema,
  inlineText,
  isHeadingLevel,
  renderedMarkSchema,
  renderedTextSchema,
} from "./rendered-block.js";
export {
  renderedBlockSchema,
  renderedMaterialBodySchema,
} from "./rendered-block-schema.js";

export type {
  ImageVariants,
  ImageAssetPresentation,
  ImageFormat,
} from "./rendered-block.js";

export {
  readerBlocksSchema,
  type ContentReaderBlock,
  type ExerciseContent,
  type MatchContent,
  type OrderContent,
  type QuizContent,
} from "./exercise-content.js";
export { materialHeadingAnchors } from "./heading-anchors.js";
export type {
  RenderedExercise,
  RenderedMatch,
  RenderedOrder,
  RenderedQuiz,
} from "./rendered-block.js";

export {
  exerciseIdSchema,
  exerciseKinds,
  isExerciseKind,
  type ExerciseKind,
} from "./exercise-rules.js";
export {
  checkExerciseAnswer,
  exerciseAnswerSchema,
  exerciseFingerprint,
  exerciseResultSchema,
  type ExerciseAnswer,
  type ExerciseKey,
  type ExerciseResult,
} from "./exercise-answer.js";
export {
  materialExercises,
  materialExerciseNumbers,
  materialExerciseReferenceIssue,
  materialExerciseReferencesValid,
  type MaterialExerciseNumber,
} from "./exercise-document.js";

export { resourceCardUrlValid } from "./blocks/resource-card.js";

export { videoChaptersSchema } from "./blocks/video.js";

export { glossaryTermIdSchema } from "./glossary-term-id.js";
export {
  glossaryTermIdOf,
  isGlossaryTermHref,
  keepFirstTermMentions,
  materialGlossaryTermIds,
} from "./glossary-term.js";
