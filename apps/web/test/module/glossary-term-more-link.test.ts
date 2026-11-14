import { expect, it } from "vitest";

import { glossaryTermsById } from "@/entities/material.model";
import { courseGlossaryMoreHref } from "@/_pages/material-reader/model/course-glossary-more-href";

const term = (id: string) => ({
  id,
  title: id,
  englishTitle: null,
  shortDefinition: "Коротко.",
  fullDefinition: "Полностью.",
});

it("links «Подробнее» only to terms the reader's course Glossary lists", () => {
  const terms = glossaryTermsById(
    [term("aggregate"), term("bounded-context")],
    courseGlossaryMoreHref({ slug: "ddd", termIds: ["aggregate"] }),
  );
  expect(terms.get("aggregate")?.moreHref).toBe(
    "/products/ddd/glossary#term-aggregate",
  );
  // Introduced in another course, in no lesson, or in a lesson closed to the reader.
  expect(terms.get("bounded-context")?.moreHref).toBeUndefined();
});

it("expands every term in place outside a course", () => {
  const terms = glossaryTermsById(
    [term("aggregate")],
    courseGlossaryMoreHref(undefined),
  );
  expect(terms.get("aggregate")?.moreHref).toBeUndefined();
});
