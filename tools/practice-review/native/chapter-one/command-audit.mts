import { parse, quote } from "shell-quote";
import { readsOnly } from "../task-gates.mjs";

/** Conservative audit only; the container, not this recognizer, enforces isolation. */
export function unconsentedReviewCommands(
  commands: readonly string[],
): string[] {
  return commands.flatMap((line) => {
    try {
      return audit(line, 0);
    } catch {
      return [line];
    }
  });
}

function audit(line: string, depth: number): string[] {
  if (depth > 3 || /\$\(|`/u.test(line)) return [line];
  // Empty environment avoids consulting host values while parsing untrusted command text.
  const tokens = parse(delimitLines(line), {});
  if (
    tokens.length === 3 &&
    typeof tokens[0] === "string" &&
    /^(?:\/bin\/)?(?:bash|sh|zsh)$/u.test(tokens[0]) &&
    (tokens[1] === "-c" || tokens[1] === "-lc") &&
    typeof tokens[2] === "string"
  )
    return audit(tokens[2], depth + 1);
  const units: string[][] = [];
  let words: string[] = [];
  const flush = () => {
    if (words.length > 0) units.push(words);
    words = [];
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (typeof token === "string") words.push(token);
    else if (token !== undefined && "comment" in token) continue;
    else if (token?.op === "glob") words.push(token.pattern);
    else if (
      token !== undefined &&
      [";", "&&", "||", "|", "|&", "&"].includes(token.op)
    )
      flush();
    else if (
      token !== undefined &&
      ((token.op === ">" && tokens[index + 1] === "/dev/null") ||
        (token.op === ">&" &&
          (tokens[index + 1] === "1" || tokens[index + 1] === "2")))
    ) {
      // Diagnostic-only redirects; project/file redirection remains unconsented.
      if (["1", "2"].includes(words.at(-1) ?? "")) words.pop();
      index += 1;
    } else return [line];
  }
  flush();
  return units.filter((unit) => !reading(unit)).map((unit) => quote(unit));
}

/** shell-quote treats line breaks as whitespace; shell command boundaries must survive. */
function delimitLines(line: string) {
  let quoted: "'" | '"' | undefined;
  let comment = false;
  let result = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    const next = line[index + 1];
    if (comment) {
      if (character === "\n" || character === "\r") {
        comment = false;
        result += ";";
      }
      continue;
    }
    if (character === "\\" && quoted !== "'") {
      if (next !== "\n" && next !== "\r") result += character + (next ?? "");
      index += 1;
      continue;
    }
    if (
      (character === "'" || character === '"') &&
      (quoted === undefined || quoted === character)
    )
      quoted = quoted === undefined ? character : undefined;
    else if (quoted === undefined) {
      if (
        character === "#" &&
        (index === 0 || /[\s;|&()<>]/u.test(line[index - 1] ?? ""))
      ) {
        comment = true;
        continue;
      }
      if (character === "\n" || character === "\r") {
        result += ";";
        continue;
      }
    }
    result += character;
  }
  if (quoted !== undefined) throw Error("Unterminated shell quote");
  return result;
}

function reading(input: readonly string[]) {
  const words = [...input];
  const program = words[0] ?? "";
  if (program.includes("/") && !/^\/(?:usr\/)?bin\/[^/]+$/u.test(program))
    return false;
  words[0] = program.split("/").at(-1) ?? program;
  if (words[0] === "git") {
    if (words[1] === "--no-optional-locks") words.splice(1, 1);
    if (words[1] === "-C" && words[2] === "/project") words.splice(1, 2);
    if (words[1] === "symbolic-ref")
      return (
        words.at(-1) === "HEAD" &&
        words
          .slice(2, -1)
          .every((value) => ["--quiet", "-q", "--short"].includes(value))
      );
    if (words[1] === "config") {
      const flags = words.slice(2);
      if (["--local", "--global", "--system"].includes(flags[0] ?? ""))
        flags.shift();
      const operation = flags.shift();
      return (
        ["--get", "--get-all", "--get-regexp"].includes(operation ?? "") &&
        flags.length >= 1 &&
        flags.length <= 2 &&
        flags.every((value) => !value.startsWith("-"))
      );
    }
    if (
      words[1] === "ls-files" ||
      (words[1] === "worktree" && words[2] === "list")
    )
      return true;
  }
  if (words[0] === "sort")
    return words.length === 1 || (words.length === 2 && words[1] === "-u");
  return readsOnly(words.join(" "));
}
