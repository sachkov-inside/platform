export {
  assembleContentCovers,
  CONTENT_COVERS,
  contentCoverOwnerKindSchema,
  type ContentCovers,
  type ContentCoverOwner,
  type ContentCoverProjection,
  type ChangeContentCoverCommand,
  type ChangeContentCoverResult,
} from "./facets/content-covers/content-covers.js";
export {
  routeContentCoverSelection,
  type ContentCoverSelection,
} from "./facets/content-covers/cover-selection.js";
export { loadContentCoverProjections } from "./infrastructure/postgres/content-cover-projections.js";
export {
  assembleContentCoverMaintenance,
  type ContentCoverMaintenance,
} from "./features/cleanup-content-covers/cleanup-content-covers.js";
