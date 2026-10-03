import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extract } from "tar";

/**
 * Снимок репозитория по точному commit SHA (#788): архив распаковывается во временный каталог на
 * время одной проверки и удаляется после неё. Код участника в базе не хранится. Сохраняются только
 * обычные файлы: символические и жёсткие ссылки отбрасываются, поэтому чтение не выходит за
 * пределы снимка.
 */
export interface RepositorySnapshot {
  /** Есть ли в снимке обычный файл по этому пути. */
  hasFile(path: string): boolean;
  listFiles(prefix: string): {
    readonly files: readonly SnapshotFile[];
    readonly truncated: boolean;
  };
  readFile(
    path: string,
    startLine: number,
    endLine: number,
  ): Promise<
    | {
        readonly ok: true;
        readonly path: string;
        readonly startLine: number;
        readonly endLine: number;
        readonly totalLines: number;
        readonly text: string;
        readonly truncated: boolean;
      }
    | { readonly ok: false; readonly reason: "not_found" | "binary" }
  >;
  searchText(
    query: string,
    prefix: string,
  ): Promise<{
    readonly matches: readonly {
      readonly path: string;
      readonly line: number;
      readonly text: string;
    }[];
    readonly truncated: boolean;
  }>;
  dispose(): Promise<void>;
}

export interface SnapshotFile {
  readonly path: string;
  readonly bytes: number;
}

export interface SnapshotLimits {
  readonly unpackedByteLimit: number;
  readonly fileCountLimit: number;
}

const defaultLimits: SnapshotLimits = {
  unpackedByteLimit: 200 * 1024 * 1024,
  fileCountLimit: 20_000,
};
/** Ответы инструментов ограничены, чтобы один вызов не съел контекст модели. */
const listedFileLimit = 500;
const readLineLimit = 400;
const readCharacterLimit = 40_000;
const searchMatchLimit = 100;
const searchFileByteLimit = 1024 * 1024;
const matchCharacterLimit = 300;

export async function openRepositorySnapshot(
  archive: Uint8Array,
  parentDirectory: string,
  limits: Partial<SnapshotLimits> = {},
): Promise<
  | { readonly ok: true; readonly value: RepositorySnapshot }
  | { readonly ok: false; readonly reason: "too_large" }
> {
  const { unpackedByteLimit, fileCountLimit } = { ...defaultLimits, ...limits };
  const root = await mkdtemp(join(parentDirectory, "review-"));
  let bytes = 0;
  let count = 0;
  const limit = { exceeded: false };
  let files: readonly SnapshotFile[];
  try {
    await pipeline(
      Readable.from([archive]),
      extract({
        cwd: root,
        strip: 1,
        // Только обычные файлы и каталоги; ссылки, устройства и прочее не распаковываются. После
        // превышения предела не пишется ничего: архив дочитывается и отбрасывается целиком.
        filter: (_path, entry) => {
          if (limit.exceeded || !("type" in entry)) return false;
          if (entry.type === "Directory") return true;
          if (entry.type !== "File") return false;
          count += 1;
          bytes += entry.size;
          limit.exceeded = count > fileCountLimit || bytes > unpackedByteLimit;
          return !limit.exceeded;
        },
      }),
    );
    if (limit.exceeded) {
      await rm(root, { recursive: true, force: true });
      return { ok: false, reason: "too_large" };
    }
    files = await indexFiles(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { ok: true, value: snapshotOf(root, files) };
}

async function indexFiles(root: string): Promise<readonly SnapshotFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: SnapshotFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files.push({
      path: relative(root, absolute).split(sep).join("/"),
      bytes: (await stat(absolute)).size,
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function snapshotOf(
  root: string,
  files: readonly SnapshotFile[],
): RepositorySnapshot {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const underPrefix = (prefix: string) => {
    const normalized = prefix.replace(/^\/+|\/+$/gu, "");
    return normalized === ""
      ? files
      : files.filter(
          ({ path }) =>
            path === normalized || path.startsWith(`${normalized}/`),
        );
  };
  // Путь ищется только в индексе распакованных файлов: чужой путь до диска не доходит.
  const text = async (path: string): Promise<string | undefined> => {
    const file = byPath.get(path);
    if (file === undefined) return undefined;
    const content = await readFile(join(root, ...path.split("/")));
    return content.subarray(0, 8_192).includes(0)
      ? undefined
      : content.toString("utf8");
  };
  return {
    hasFile: (path) => byPath.has(path),
    listFiles(prefix) {
      const listed = underPrefix(prefix);
      return {
        files: listed.slice(0, listedFileLimit),
        truncated: listed.length > listedFileLimit,
      };
    },
    async readFile(path, startLine, endLine) {
      if (!byPath.has(path)) return { ok: false, reason: "not_found" };
      const content = await text(path);
      if (content === undefined) return { ok: false, reason: "binary" };
      const lines = splitLines(content);
      const first = Math.max(1, startLine);
      const requestedLast = Math.min(
        lines.length,
        Math.max(first, endLine),
        first + readLineLimit - 1,
      );
      const numbered: string[] = [];
      let characters = 0;
      let last = first - 1;
      for (let line = first; line <= requestedLast; line += 1) {
        const rendered = `${String(line)}| ${lines[line - 1] ?? ""}`;
        if (characters + rendered.length > readCharacterLimit) break;
        numbered.push(rendered);
        characters += rendered.length + 1;
        last = line;
      }
      return {
        ok: true,
        path,
        startLine: first,
        endLine: last,
        totalLines: lines.length,
        text: numbered.join("\n"),
        truncated: last < Math.min(lines.length, Math.max(first, endLine)),
      };
    },
    async searchText(query, prefix) {
      const needle = query.toLocaleLowerCase("ru");
      const matches: { path: string; line: number; text: string }[] = [];
      if (needle.trim() === "") return { matches, truncated: false };
      for (const file of underPrefix(prefix)) {
        if (file.bytes > searchFileByteLimit) continue;
        const content = await text(file.path);
        if (content === undefined) continue;
        const lines = splitLines(content);
        for (const [index, line] of lines.entries()) {
          if (!line.toLocaleLowerCase("ru").includes(needle)) continue;
          if (matches.length === searchMatchLimit)
            return { matches, truncated: true };
          matches.push({
            path: file.path,
            line: index + 1,
            text: line.trim().slice(0, matchCharacterLimit),
          });
        }
      }
      return { matches, truncated: false };
    },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

function splitLines(content: string): readonly string[] {
  const lines = content.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
