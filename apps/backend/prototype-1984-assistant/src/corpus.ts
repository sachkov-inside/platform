// PROTOTYPE, throwaway (#1984). Cuts the real course materials into parts by headings.
// Reads the latest Content Studio export; course text never enters git (the repository is public).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const packagePath =
  process.env.CONTENT_PACKAGE ??
  resolve(
    homedir(),
    "Work/Materials/content-studio/_local/platform-468/local-stand/packages/b60fc360338a2e6faeeb5faed94c6e04de61687b2f3ba84d79168c8da7f2fa5b/package.json",
  );

type Material = { sourceId: string; title: string; access: string | null; markdown: string };
export type Part = {
  id: string;
  materialId: string;
  materialTitle: string;
  access: string;
  heading: string;
  path: string;
  text: string;
};

const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { materials: Material[] };

function clean(markdown: string): string {
  return markdown
    .replace(/```video[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^> \[!\w+\]-?\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const parts: Part[] = [];
for (const material of pkg.materials) {
  const lines = material.markdown.split("\n");
  let heading = material.title;
  let h2 = "";
  let buffer: string[] = [];
  let index = 0;
  let inFence = false;
  const flush = () => {
    const text = clean(buffer.join("\n"));
    if (text.length > 0)
      parts.push({
        id: `${material.sourceId}#${index++}`,
        materialId: material.sourceId,
        materialTitle: material.title,
        access: material.access ?? "course",
        heading,
        path: [material.title, h2 && h2 !== heading ? h2 : "", heading].filter(Boolean).join(" › "),
        text,
      });
    buffer = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    const match = !inFence && /^(#{2,3}) (.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      if (match[1] === "##") h2 = heading;
      continue;
    }
    buffer.push(line);
  }
  flush();
}

writeFileSync(new URL("../.data/parts.json", import.meta.url), JSON.stringify(parts, null, 1));
const sizes = parts.map((p) => p.text.length).sort((a, b) => a - b);
console.log({
  materials: pkg.materials.length,
  parts: parts.length,
  chars: sizes.reduce((a, b) => a + b, 0),
  median: sizes[Math.floor(sizes.length / 2)],
  p90: sizes[Math.floor(sizes.length * 0.9)],
  max: sizes.at(-1),
  under200: sizes.filter((s) => s < 200).length,
});
// Outline for the question writer: titles and headings only, no section text.
const outline = parts.map((p) => `${p.id}\t${p.path}`).join("\n");
writeFileSync(new URL("../.data/outline.tsv", import.meta.url), outline + "\n");
