import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const alternatives = vi.hoisted(() => ({ loaded: vi.fn() }));

vi.mock(
  "@/features/ai-engineering-course/model/course-film",
  async (original) => {
    const film = await original();
    alternatives.loaded("v1");
    return film;
  },
);
vi.mock(
  "@/features/ai-engineering-course/model/course-film-v2",
  async (original) => {
    const film = await original();
    alternatives.loaded("v2");
    return film;
  },
);

import { CourseFilm } from "@/features/ai-engineering-course";

describe("CourseFilm initial module loading", () => {
  it("server-renders the default film without evaluating either alternative", () => {
    const html = renderToString(createElement(CourseFilm));
    expect(html).toContain('role="img"');
    expect(html).toContain("<canvas");
    expect(alternatives.loaded.mock.calls).toEqual([]);
  });
});
