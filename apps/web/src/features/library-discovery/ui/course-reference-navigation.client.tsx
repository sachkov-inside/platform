"use client";

import { useId, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { Route } from "next";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import {
  anchoredMaterialHref,
  type ReaderCourseAnchor,
} from "@/shared/routing/reader-course-anchor";
import type { CourseReferenceMaterial } from "../model/course-reading";
import styles from "./course-reading.module.css";

/** Reference documents remain outside chapter step navigation. */
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
    <ReferenceList
      key={JSON.stringify(references.map((reference) => reference.id))}
      references={references}
      activeReferenceId={activeReferenceId}
      courseHref={courseHref}
      anchor={anchor}
    />
  );
}

function ReferenceList({
  references,
  activeReferenceId,
  courseHref,
  anchor,
}: Parameters<typeof CourseReferenceNavigation>[0]) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visibleReferences = expanded ? references : references.slice(0, 3);
  return (
    <nav aria-label="Дополнительные материалы" className={styles["references"]}>
      <h2>Дополнительные материалы</h2>
      <ul id={listId}>
        {visibleReferences.map((reference) => (
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
      {references.length > 3 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <ChevronDown aria-hidden="true" size={16} />
          {expanded ? "Скрыть" : "Показать ещё"}
        </button>
      ) : null}
    </nav>
  );
}
