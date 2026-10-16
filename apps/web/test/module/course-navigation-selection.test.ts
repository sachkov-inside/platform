import { expect, test } from "vitest";
import { courseGuide, courseNext } from "@/storybook/course-reading.fixtures";
import {
  reconcileCourseNavigation,
  selectCourseNavigation,
} from "@/features/library-discovery/model/course-navigation-selection";

test("a click projects the destination chapter without changing authoritative progress or composition", () => {
  const selected = selectCourseNavigation(courseGuide, courseNext.current.id);
  expect(selected.current.id).toBe(courseNext.current.id);
  expect(selected.currentChapterId).toBe(courseNext.currentChapterId);
  expect(selected.currentPosition).toBe(courseNext.currentPosition);
  expect(selected.chapters).toBe(courseGuide.chapters);
  expect(selected.totalSteps).toBe(courseGuide.totalSteps);
  expect(courseGuide.current.id).toBe("material:course-intro");
});

test("reference clicks preserve the originating step; ordinary steps clear the reference highlight", () => {
  const reference = selectCourseNavigation(
    courseGuide,
    "reference:aie-project",
  );
  expect(reference.activeReferenceId).toBe("reference:aie-project");
  expect(reference.current).toBe(courseGuide.current);
  expect(
    selectCourseNavigation(reference, courseNext.current.id).activeReferenceId,
  ).toBeUndefined();
  expect(selectCourseNavigation(courseGuide, "missing")).toBe(courseGuide);
});

test("late source status publications retain a pending selection until its destination arrives", () => {
  const intent = {
    id: courseNext.current.id,
    courseHref: courseGuide.courseHref,
  };
  expect(reconcileCourseNavigation(intent, { ...courseGuide })).toBe(intent);
  expect(reconcileCourseNavigation(intent, courseNext)).toBeNull();
  expect(reconcileCourseNavigation(intent, null)).toBeNull();
  expect(
    reconcileCourseNavigation(intent, {
      ...courseGuide,
      courseHref: courseNext.current.href,
    }),
  ).toBeNull();
});

test("a reference source refresh cannot confirm a return to its originating lesson", () => {
  const reference = selectCourseNavigation(
    courseGuide,
    "reference:aie-project",
  );
  const intent = {
    id: courseGuide.current.id,
    courseHref: courseGuide.courseHref,
  };
  expect(reconcileCourseNavigation(intent, reference)).toBe(intent);
  expect(reconcileCourseNavigation(intent, courseGuide)).toBeNull();
});
