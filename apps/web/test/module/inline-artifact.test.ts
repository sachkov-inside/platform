import { z } from "zod";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readInlineArtifactReference } from "@/features/product-artifacts/model/inline-artifact";
import { downloadInlineArtifact } from "@/features/product-artifacts/api/inline-artifact-file-bff.server";
import { ReaderInlineArtifact } from "@/features/product-artifacts/ui/reader-inline-artifact.server";

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: () => Promise.resolve("reader-token"),
}));
const productId = "72000000-0000-4000-8000-000000000101";
const sourceId = "inside-content:aie-customer-brief";
const href = `/api/products/${productId}/artifact-sources/${encodeURIComponent(sourceId)}/file`;
const artifact = {
  artifactId: "72000000-0000-4000-8000-000000000201",
  sourceId,
  availability: "available",
  content: {
    contentType: "text/markdown",
    filename: "customer-brief.md",
    kind: "file",
    size: 22,
  },
  title: "Бриф заказчика (.md)",
  purpose: "",
  updatedAt: "2026-10-15T00:00:00.000Z",
  version: 4,
};

describe("Inline artifact binding and current protected download", () => {
  beforeEach(() =>
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test"),
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("recognizes only a complete same-origin imported source binding", () => {
    expect(readInlineArtifactReference(href)).toEqual({ productId, sourceId });
    for (const invalid of [
      "artifact:aie-customer-brief",
      "https://evil.test" + href,
      href + "?version=1",
      href + "#part",
      href.replace(productId, "bad"),
      href.replace(encodeURIComponent(sourceId), "%ZZ"),
    ]) {
      expect(readInlineArtifactReference(invalid)).toBeUndefined();
    }
  });
  it("resolves the current version and preserves Markdown bytes and readable filename", async () => {
    const bytes = "# Бриф заказчика\n";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ artifacts: [artifact] }))
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: {
            "content-type": "text/markdown",
            "content-disposition": 'attachment; filename="customer-brief.md"',
            "cache-control": "public, max-age=31536000, immutable",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await downloadInlineArtifact(
      new Request("https://inside.test" + href),
      { productId, sourceId },
    );
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(bytes);
    expect(result.headers.get("content-disposition")).toBe(
      'attachment; filename="customer-brief.md"',
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `https://platform-api.example.test/products/${productId}/artifacts/${artifact.artifactId}/file?version=4`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { authorization: "Bearer reader-token" },
      redirect: "manual",
    });
  });
  it.each([
    { ...artifact, availability: "locked" },
    { ...artifact, sourceId: "inside-content:other" },
    {
      ...artifact,
      content: { kind: "link", externalUrl: "https://example.test" },
    },
  ])("never delivers locked, unrelated or non-file content", async (item) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ artifacts: [item] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await downloadInlineArtifact(
      new Request("https://inside.test" + href),
      { productId, sourceId },
    );
    expect(result.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("preserves a protected redirect and its no-store policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ artifacts: [{ ...artifact, version: 7 }] }),
        )
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: {
              location: "https://storage.example.test/signed-file",
              "cache-control": "private, no-store",
            },
          }),
        ),
    );
    const result = await downloadInlineArtifact(
      new Request("https://inside.test" + href),
      { productId, sourceId },
    );
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe(
      "https://storage.example.test/signed-file",
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(
      z
        .instanceof(URL)
        .parse(vi.mocked(fetch).mock.calls[1]?.[0])
        .searchParams.get("version"),
    ).toBe("7");
  });
  it("returns a bounded dependency state when lookup is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(
      (
        await downloadInlineArtifact(
          new Request("https://inside.test" + href),
          { productId, sourceId },
        )
      ).status,
    ).toBe(503);
  });
  it.each([
    new Response(null, { status: 500 }),
    Response.json({ artifacts: [{ invalid: true }] }),
  ])(
    "keeps a failed inline file inside its unavailable state",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const html = renderToStaticMarkup(
        await ReaderInlineArtifact({
          reference: { productId, sourceId },
          href,
          label: "Скачать бриф (.md)",
        }),
      );
      expect(html).toContain("Файл сейчас недоступен");
      expect(html).not.toContain("href=");
    },
  );
});
