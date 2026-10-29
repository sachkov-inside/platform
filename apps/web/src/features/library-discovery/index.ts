export type {
  LibraryDiscoveryKind,
  LibraryDiscoveryReference,
  LibraryDiscoveryResult,
  DiscoveryTopic,
  ProductAccess,
  ProductChapter,
  ProductIntroduction,
  RelatedPlaylist,
  PublishedProductResult,
  PublishedTopicResult,
  RelatedMaterialsResult,
} from "./model/library-discovery-view";
export {
  formatMaterialCount,
  PlaylistCard,
  TopicCard,
  type PlaylistCardPresentation,
  type TopicCardPresentation,
} from "./ui/collection-cards";
export {
  courseReadingContext,
  isProgrammeStepOpenedForReference,
  type CourseReadingContext,
  type CourseReadingStep,
  type CourseReferenceMaterial,
} from "./model/course-reading";
export {
  CourseTaskSubmissionStatuses,
  CourseReadingLayout,
  CourseReadingHeader,
  CourseReadingFooter,
} from "./ui/course-reading.client";

export { CourseReferenceNavigation } from "./ui/course-reference-navigation.client";
export {
  CourseNavigationBar,
  CourseNavigationItem,
} from "./ui/course-navigation-bar.client";

export { CourseReadingHost } from "./ui/course-reading-host.client";
