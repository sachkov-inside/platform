"use client";

import { createContext } from "react";
import type { CourseReadingContext } from "../model/course-reading";

export interface CourseFramePublication {
  readonly context: CourseReadingContext | null;
  readonly supplementaryTitle?: string | undefined;
  readonly pathname: string;
}

/** Pages publish validated presentation; the persistent shell owns its mounted navigation. */
export const CourseReadingHostContext = createContext<{
  readonly publish: (publication: CourseFramePublication) => void;
  readonly active: boolean;
} | null>(null);
