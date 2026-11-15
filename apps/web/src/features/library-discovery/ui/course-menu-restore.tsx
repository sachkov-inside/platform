import { courseMenuRestoreSource } from "../model/course-menu";

/**
 * Applies the saved lesson-menu choice before the shell is parsed, so a collapsed menu never
 * paints expanded first. The server renders it once; the persistent shell never re-renders it.
 */
export function CourseMenuRestore() {
  return (
    <script dangerouslySetInnerHTML={{ __html: courseMenuRestoreSource }} />
  );
}
