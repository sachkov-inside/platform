import { describe, expect, it } from "vitest";

import { assertDeclaredViewport } from "../../.storybook/viewport-guard";

const declared = {
  viewport: {
    options: {
      desktop1440: { name: "Desktop 1440 × 900", styles: { height: "900px", width: "1440px" } },
      mobile390: { name: "Mobile 390 × 844", styles: { height: "844px", width: "390px" } },
    },
  },
};

const story = { name: "Topic · mobile", title: "Pages/Collections" };

describe("Storybook viewport guard", () => {
  it("accepts a story without a viewport", () => {
    expect(() => {
      assertDeclaredViewport({ ...story, globals: {}, parameters: declared });
    }).not.toThrow();
  });

  it("accepts a declared viewport name", () => {
    expect(() => {
      assertDeclaredViewport({
        ...story,
        globals: { viewport: { isRotated: false, value: "mobile390" } },
        parameters: declared,
      });
    }).not.toThrow();
  });

  it("accepts a size the story declares for itself", () => {
    expect(() => {
      assertDeclaredViewport({
        ...story,
        globals: { viewport: { isRotated: false, value: "tablet768" } },
        parameters: {
          viewport: {
            options: {
              ...declared.viewport.options,
              tablet768: { name: "Tablet 768", styles: { height: "1024px", width: "768px" } },
            },
          },
        },
      });
    }).not.toThrow();
  });

  it("rejects an undeclared global viewport and names the declared ones", () => {
    expect(() => {
      assertDeclaredViewport({
        ...story,
        globals: { viewport: { isRotated: false, value: "mobile360" } },
        parameters: declared,
      });
    }).toThrow(
      'История «Pages/Collections › Topic · mobile» просит размер «mobile360», которого нет среди объявленных: desktop1440, mobile390.',
    );
  });

  it("rejects an undeclared legacy string global", () => {
    expect(() => {
      assertDeclaredViewport({ ...story, globals: { viewport: "mobile1" }, parameters: declared });
    }).toThrow("«mobile1»");
  });

  it("rejects an undeclared default viewport parameter", () => {
    expect(() => {
      assertDeclaredViewport({
        ...story,
        globals: {},
        parameters: { viewport: { ...declared.viewport, defaultViewport: "mobile360" } },
      });
    }).toThrow("«mobile360»");
  });

  it("rejects any name when no size is declared", () => {
    expect(() => {
      assertDeclaredViewport({
        ...story,
        globals: { viewport: { value: "mobile390" } },
        parameters: {},
      });
    }).toThrow("объявленных: нет");
  });
});
