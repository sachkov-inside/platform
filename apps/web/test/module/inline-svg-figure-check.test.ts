import { readFileSync } from "node:fs";

import {
  checkInlineSvgMarkup,
  checkSvgMarkup,
} from "@inside/material-blocks/svg-image";
import { describe, expect, test } from "vitest";

const fixture = (path: string) =>
  readFileSync(
    new URL(`../../.storybook/fixtures/svg-figures/${path}`, import.meta.url),
    "utf8",
  );

/** A figure in the shape Content Studio generates, with `style` as its stylesheet. */
function figure(style: string, body = "", rootId = "fig-loop-wide") {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="${rootId}" width="720" height="240" viewBox="0 0 720 240"><style>${style}</style>${body}<text x="10" y="20">Шаг</text></svg>`;
}

describe("Inline SVG figure check (#2041)", () => {
  test("a wide/tall pair that follows the contract goes into the page", () => {
    for (const path of ["wide/720", "tall/360"]) {
      const checked = checkInlineSvgMarkup(fixture(path));
      expect(checked).toMatchObject({ ok: true });
      expect(checked.ok && checked.value.markup).toContain(
        "var(--fig-play, running)",
      );
    }
    // `hostile` targets only its own root: its frame, not the check, keeps it in place.
    expect(checkInlineSvgMarkup(fixture("hostile/400"))).toMatchObject({
      ok: true,
    });
  });

  test("a figure that passes the upload check but not the scope rules stays an image", () => {
    const unscoped = fixture("unscoped/400");
    expect(checkSvgMarkup(unscoped)).toMatchObject({ ok: true });
    expect(checkInlineSvgMarkup(unscoped)).toEqual({
      error: { code: "unsafe_svg" },
      ok: false,
    });
    expect(checkInlineSvgMarkup(fixture("unsafe/400"))).toEqual({
      error: { code: "unsafe_svg" },
      ok: false,
    });
  });

  test.each([
    ["#fig-loop-wide .step{opacity:0}"],
    ["#fig-loop-wide>.step,#fig-loop-wide text{fill:#111}"],
    ["#fig-loop-wide-arrow{stroke:#111}"],
    ["#fig-loop-wide:not(.x) .step{opacity:1}"],
    ["#fig-loop-wide .a ~ .b{opacity:1}"],
    [
      "@media (prefers-reduced-motion: reduce){#fig-loop-wide .step{animation:none}}",
    ],
    [
      "@supports (opacity: 1){@media (min-width: 1px){#fig-loop-wide g{opacity:1}}}",
    ],
    ["@keyframes a-fade{from{opacity:0}to{opacity:1}}"],
    ["@keyframes fig-loop-wide-spin{0%{opacity:0}100%{opacity:1}}"],
    ["#fig-loop-wide .s{fill:url(#fig-loop-wide-gradient)}"],
  ])("accepts the scoped stylesheet %s", (style) => {
    expect(checkInlineSvgMarkup(figure(style))).toMatchObject({ ok: true });
  });

  test.each([
    ["an element selector", "text{fill:red}"],
    ["a universal selector", "*{opacity:0}"],
    ["a list with a page selector", "#fig-loop-wide .a, p{color:red}"],
    ["the root's next sibling", "#fig-loop-wide + p{color:red}"],
    ["the root's later siblings", "#fig-loop-wide.x ~ p{color:red}"],
    ["siblings after a figure id", "#fig-loop-wide-box~p{color:red}"],
    ["an id of another figure", "#fig-other-wide .a{fill:red}"],
    ["a root that starts with :is()", ":is(#fig-loop-wide) ~ p{color:red}"],
    ["the host or page root", ":root{--x:1}"],
    ["a nested rule", "#fig-loop-wide{opacity:1;&amp; ~ p{color:red}}"],
    [
      "a page selector inside @media",
      "@media (min-width: 1px){body{color:red}}",
    ],
    ["a page keyframes name", "@keyframes spin{to{opacity:0}}"],
    [
      "an unclosed group",
      "@media (min-width: 1px){#fig-loop-wide g{opacity:1}",
    ],
    [
      "a reference outside the figure",
      "#fig-loop-wide g{fill:url(#page-gradient)}",
    ],
    // Security review of #2041: an unmatched bracket hid a page rule from the scope rules, while
    // the browser drops only the broken rule and applies the next one to the page.
    [
      "a stray ) that hides a page rule",
      '#fig-loop-wide ) {} body::before{content:"x";position:fixed} ( {}',
    ],
    [
      "a [ ) ] that hides a page rule",
      "#fig-loop-wide [ ) ] {} body{display:none} [ ( ] {}",
    ],
    ["an unclosed (", "#fig-loop-wide ( {} body{display:none}"],
    ["a mismatched ( ]", "#fig-loop-wide ( ] {} body{display:none} [ ) {}"],
    [
      "a } inside a declaration's parentheses",
      "#fig-loop-wide{x:( } ) } body{display:none}",
    ],
  ])("refuses %s", (_name, style) => {
    // The upload check accepts the file: only the scope rules keep it out of the page.
    expect(checkSvgMarkup(figure(style))).toMatchObject({ ok: true });
    expect(checkInlineSvgMarkup(figure(style))).toEqual({
      error: { code: "unsafe_svg" },
      ok: false,
    });
  });

  test.each([
    ["no root id", figure("", "", "")],
    ["a root id outside fig-", figure("", "", "loop-wide")],
    ["an inner id without the prefix", figure("", '<g id="main"/>')],
    ["a reference to a page element", figure("", '<use href="#page-icon"/>')],
    ["a label from the page", figure("", '<g aria-labelledby="page-title"/>')],
    [
      "a fill from the page",
      figure("", '<rect width="1" height="1" fill="url(#page-gradient)"/>'),
    ],
  ])("refuses %s", (_name, markup) => {
    expect(checkSvgMarkup(markup.replace(' id=""', ""))).toMatchObject({
      ok: true,
    });
    expect(checkInlineSvgMarkup(markup.replace(' id=""', ""))).toEqual({
      error: { code: "unsafe_svg" },
      ok: false,
    });
  });
});
