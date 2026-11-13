import type { Subject } from "../../../content-access/index.js";
import type { Result } from "../../result.js";
import type { PublishedMaterialDiscoveryError } from "../discover-published-material-projections/discover-published-material-projections.contract.js";
import type { PublishedGlossaryTermDto } from "../read-published-material/read-published-material.contract.js";

export interface ReadCourseGlossaryQuery {
  readonly subject: Subject;
  readonly productSlug: string;
}

/** A course Glossary term with the lesson that introduces it. */
export interface CourseGlossaryTermDto extends PublishedGlossaryTermDto {
  readonly lesson: { readonly slug: string; readonly title: string };
}

export interface CourseGlossaryDto {
  readonly product: { readonly slug: string; readonly name: string };
  /** Terms introduced by the course lessons the reader may read, by title. */
  readonly terms: readonly CourseGlossaryTermDto[];
}

export type CourseGlossaryResult = Result<
  CourseGlossaryDto,
  PublishedMaterialDiscoveryError
>;

export type ReadCourseGlossaryOperation = (
  query: ReadCourseGlossaryQuery,
) => Promise<CourseGlossaryResult>;
