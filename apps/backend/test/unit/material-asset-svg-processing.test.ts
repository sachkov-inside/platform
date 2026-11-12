import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { processMaterialAssetBytes } from "../../src/modules/assets/facets/material-assets/process-material-asset-bytes.js";

const samplesDirectory = new URL("../fixtures/svg-images/", import.meta.url);
const samples = readdirSync(samplesDirectory)
  .filter((name) => name.endsWith(".svg"))
  .toSorted();

function checksum(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function processSvg(source: string | Uint8Array) {
  const body =
    typeof source === "string" ? new TextEncoder().encode(source) : source;
  return processMaterialAssetBytes({
    body,
    declaredContentType: "image/svg+xml",
    declaredSize: body.byteLength,
    expectedChecksumSha256: checksum(body),
    filename: "diagram.svg",
    kind: "image",
  });
}

function svg(inner: string, rootAttributes = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"${rootAttributes}>${inner}</svg>`;
}

function decode(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

describe("SVG material image processing", () => {
  test("the eleven Content Studio samples are copied as fixtures", () => {
    expect(samples).toHaveLength(11);
  });

  test.each(samples)(
    "%s passes as an animated SVG image with its own size",
    async (name) => {
      const uploaded = readFileSync(new URL(name, samplesDirectory));
      const source = uploaded.toString("utf8");
      const declared = /<svg[^>]*\swidth="(\d+)"\s+height="(\d+)"/u.exec(
        source,
      );
      const result = await processSvg(uploaded);

      expect(result.ok).toBe(true);
      if (!result.ok || result.value.kind !== "image") {
        throw new Error("Expected a processed SVG image");
      }
      expect(result.value).toMatchObject({
        checksumSha256: checksum(uploaded),
        contentType: "image/svg+xml",
        kind: "image",
        size: uploaded.byteLength,
        width: Number(declared?.[1]),
        height: Number(declared?.[2]),
      });
      expect(result.value.original.contentType).toBe("image/svg+xml");
      expect(result.value.variants).toHaveLength(1);
      const [variant] = result.value.variants;
      expect(variant).toMatchObject({
        contentType: "image/svg+xml",
        height: Number(declared?.[2]),
        width: Number(declared?.[1]),
      });
      const served = decode(variant?.body ?? new Uint8Array());
      expect(served).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
      expect(served).toContain("@keyframes a-draw");
      expect(served).toContain("prefers-reduced-motion:reduce");
      expect(served.includes('pathLength="1"')).toBe(
        source.includes('pathLength="1"'),
      );
      // The served file is parsed again by the same rules and stays unchanged.
      const again = await processSvg(variant?.body ?? new Uint8Array());
      expect(
        again.ok && again.value.kind === "image"
          ? decode(again.value.variants[0]?.body ?? new Uint8Array())
          : null,
      ).toBe(served);
    },
  );

  test("serves the checked tree: comments are dropped, CDATA and entities are re-escaped", async () => {
    const result = await processSvg(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- author note -->\n` +
        svg(
          `<style><![CDATA[.a > .b{fill:#000}]]></style><text x="1" y="2">A &amp; B &lt; C &#x41;</text>`,
        ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "image") throw new Error("not ok");
    expect(decode(result.value.variants[0]?.body ?? new Uint8Array())).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
        '<style>.a &gt; .b{fill:#000}</style><text x="1" y="2">A &amp; B &lt; C A</text></svg>',
    );
  });

  test.each([
    ["only a viewBox", 'viewBox="0 0 640 360"', 640, 360],
    ["a width and a viewBox", 'width="320" viewBox="0 0 640 360"', 320, 180],
    ["pixel units", 'width="300px" height="150px"', 300, 150],
    [
      "percent width falls back to viewBox",
      'width="100%" viewBox="0 0 40 20"',
      40,
      20,
    ],
  ])(
    "takes the layout size from %s",
    async (_label, attributes, width, height) => {
      const result = await processSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="1" height="1"/></svg>`,
      );
      expect(result).toMatchObject({ ok: true, value: { height, width } });
    },
  );

  test.each([
    ["a script element", svg("<script>alert(1)</script>")],
    ["an onload attribute", svg("", ' onload="alert(1)"')],
    [
      "an event attribute on a child",
      svg('<rect width="1" height="1" onclick="x()"/>'),
    ],
    [
      "foreignObject",
      svg(
        '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
      ),
    ],
    ["an iframe", svg("<iframe/>")],
    ["an embedded image", svg('<image href="https://example.com/a.png"/>')],
    ["a link", svg('<a href="https://example.com"><text>x</text></a>')],
    ["an external use href", svg('<use href="https://example.com/s.svg#a"/>')],
    [
      "an external xlink:href",
      svg(
        '<use xlink:href="/sprite.svg#a"/>',
        ' xmlns:xlink="http://www.w3.org/1999/xlink"',
      ),
    ],
    ["a javascript: href", svg('<use href="javascript:alert(1)"/>')],
    [
      "an entity-encoded javascript: href",
      svg('<use href="&#106;avascript:alert(1)"/>'),
    ],
    ["CSS @import", svg('<style>@import "https://example.com/a.css";</style>')],
    [
      "an external CSS url",
      svg("<style>.a{fill:url(https://example.com/x)}</style>"),
    ],
    [
      "an escaped CSS url",
      svg("<style>.a{fill:u\\72l(https://example.com/x)}</style>"),
    ],
    [
      "an external url in a style attribute",
      svg('<rect style="fill:url(//example.com/x)"/>'),
    ],
    [
      "an external url in a presentation attribute",
      svg('<rect fill="url(https://example.com/x#a)"/>'),
    ],
    [
      "an external font",
      svg(
        "<style>@font-face{font-family:x;src:url(https://example.com/f.woff2)}</style>",
      ),
    ],
    [
      "an unknown CSS function",
      svg("<style>.a{background:image-set(a 1x)}</style>"),
    ],
    [
      "an external url hidden behind a comment opener in a CSS string",
      svg(
        '<style>a{font-family:"/*"} svg{background:url(https://example.com/t)} b{font-family:"*/"}</style>',
      ),
    ],
    [
      "an @import hidden behind a comment opener in a CSS string",
      svg(
        '<style>a{font-family:"/*"}@import url(https://example.com/x);b{x:"*/"}</style>',
      ),
    ],
    [
      "a @font-face hidden behind a comment opener in a CSS string",
      svg(
        '<style>a{font-family:"/*"}@font-face{font-family:q;src:url(https://example.com/f)}b{x:"*/"}</style>',
      ),
    ],
    [
      "an external url hidden behind a comment opener in a style attribute string",
      svg(
        `<rect style='font-family:"/*";cursor:url(https://example.com/c),auto;x:"*/"'/>`,
      ),
    ],
    ["an unterminated CSS string", svg('<style>a{font-family:"x}</style>')],
    ["a DOCTYPE", `<!DOCTYPE svg [<!ENTITY x "y">]>${svg("")}`],
    [
      "a processing instruction",
      `<?xml-stylesheet href="https://example.com/a.css"?>${svg("")}`,
    ],
    [
      "SMIL animation",
      svg('<set attributeName="href" to="javascript:alert(1)"/>'),
    ],
    ["an XHTML namespace", svg('<g xmlns="http://www.w3.org/1999/xhtml"/>')],
    [
      "a prefixed element",
      svg('<h:script xmlns:h="http://www.w3.org/1999/xhtml"/>'),
    ],
  ])("refuses %s as unsafe_svg", async (_label, source) => {
    await expect(processSvg(source)).resolves.toEqual({
      error: { code: "unsafe_svg" },
      ok: false,
    });
  });

  test("keeps an internal xlink:href under a declared xlink namespace", async () => {
    const result = await processSvg(
      svg(
        '<g xmlns:xlink="http://www.w3.org/1999/xlink"><path id="p" d="M0 0"/><use xlink:href="#p"/></g>',
      ),
    );
    expect(result.ok).toBe(true);
  });

  test("keeps internal references to ids in the same file", async () => {
    const result = await processSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><path id="p" d="M0 0L1 1"/></defs>' +
          '<use href="#p"/><rect width="1" height="1" fill="url(#g)" style="stroke:url(\'#g\')"/>' +
          '<style>.a{fill:url("#g")}</style>',
      ),
    );
    expect(result.ok).toBe(true);
  });

  test.each([
    [
      "malformed XML",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g></svg>',
    ],
    ["no layout size", '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
    ["another root element", '<html xmlns="http://www.w3.org/1999/xhtml"/>'],
    ["no SVG namespace", '<svg width="1" height="1"/>'],
    [
      "bytes that are not UTF-8",
      Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0xff]),
    ],
    ["an xlink prefix without its namespace", svg('<use xlink:href="#a"/>')],
    ["a raw NUL character", svg("<desc>a\u0000b</desc>")],
    ["a reference to a control character", svg("<desc>a&#1;b</desc>")],
  ])("refuses %s as image_decode_failed", async (_label, source) => {
    await expect(processSvg(source)).resolves.toEqual({
      error: { code: "image_decode_failed" },
      ok: false,
    });
  });

  test("refuses an element with thousands of attributes quickly", async () => {
    const attributes = Array.from(
      { length: 50_000 },
      (_, index) => ` a${String(index)}=""`,
    ).join("");
    const started = performance.now();
    // deterministic-test-allow duration-wait: a performance window bounds the checker's work on one adversarial input.
    await expect(processSvg(svg("", attributes))).resolves.toEqual({
      error: { code: "unsafe_svg" },
      ok: false,
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("refuses an SVG over 512 KiB", async () => {
    const padding = `<desc>${"x".repeat(512 * 1024)}</desc>`;
    await expect(processSvg(svg(padding))).resolves.toEqual({
      error: { code: "image_too_large" },
      ok: false,
    });
  });

  test("still refuses an SVG uploaded as a downloadable file", async () => {
    const body = new TextEncoder().encode(svg(""));
    await expect(
      processMaterialAssetBytes({
        body,
        declaredContentType: "image/svg+xml",
        declaredSize: body.byteLength,
        expectedChecksumSha256: checksum(body),
        filename: "diagram.svg",
        kind: "file",
      }),
    ).resolves.toEqual({ error: { code: "executable_content" }, ok: false });
  });
});
