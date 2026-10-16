import { FileText } from "lucide-react";
import type { Route } from "next";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import {
  anchoredMaterialHref,
  type ReaderCourseAnchor,
} from "@/shared/routing/reader-course-anchor";
import type { CourseReferenceMaterial } from "../model/course-reading";
import styles from "./course-reading.module.css";

/** Reference documents remain outside chapter steps and their progress. */
export function CourseReferenceNavigation({
  references,
  activeReferenceId,
  courseHref,
  anchor,
}: {
  readonly references: readonly CourseReferenceMaterial[];
  readonly activeReferenceId?: string | undefined;
  readonly courseHref: Route;
  readonly anchor?: ReaderCourseAnchor | undefined;
}) {
  if (references.length === 0) return null;
  return (
    <nav aria-label="О проекте" className={styles["references"]}>
      <h2>О проекте</h2>
      <ul>
        {references.map((reference) => (
          <li key={reference.id}>
            <IntentPrefetchLink
              href={
                anchor === undefined
                  ? reference.href
                  : (anchoredMaterialHref(reference.href, courseHref, anchor) ??
                    reference.href)
              }
              aria-current={
                reference.id === activeReferenceId ? "page" : undefined
              }
              data-course-reference={reference.slug}
            >
              <FileText aria-hidden="true" size={16} />
              <span>{reference.title}</span>
            </IntentPrefetchLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
