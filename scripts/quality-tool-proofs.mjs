// @ts-check
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withPinnedTool } from "./quality-tools.mjs";
import { qualityCommand } from "./quality-command.mjs";

/** @param {string} executable @param {string[]} args @param {string} input @param {boolean} accepted @param {RegExp} [diagnostic] @param {{cwd?: string, base?: string}} [options] */
async function probe(
  executable,
  args,
  input,
  accepted,
  diagnostic,
  options = {},
) {
  const result = await qualityCommand(executable, args, {
    input,
    cwd: options.cwd,
    // Miniature proof repositories have their own source identity, not the CI candidate's base.
    env: { ...process.env, QUALITY_BASE_SHA: options.base ?? "" },
    timeout: 30_000,
  });
  assert.equal(
    result.status,
    accepted ? 0 : 1,
    `${result.stdout}${result.stderr}`,
  );
  if (diagnostic !== undefined)
    assert.match(`${result.stdout}${result.stderr}`, diagnostic);
}

const directory = mkdtempSync(join(tmpdir(), "inside-quality-proof-"));
try {
  await withPinnedTool("betterleaks", async (executable) => {
    const file = join(directory, "credentials.env");
    const config = fileURLToPath(
      new URL("../.betterleaks.toml", import.meta.url),
    );
    const args = [
      "dir",
      "--no-banner",
      "--redact=100",
      "--verbose",
      "--confidence=medium",
      "--ignore-gitleaks-allow",
      `--config=${config}`,
      file,
    ];
    writeFileSync(file, "POSTGRES_PASSWORD=inside\n");
    await probe(executable, args, "", true);
    // Provider-shaped but synthetic. Split so the positive repository scan has no credential.
    const token = ["ghp_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("");
    writeFileSync(file, `GITHUB_TOKEN=${token}\n`);
    await probe(executable, args, "", false, /github-pat/u);
    const initialized = await qualityCommand("git", ["init", "-q", directory], {
      timeout: 5_000,
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    copyFileSync(config, join(directory, ".betterleaks.toml"));
    const cli = fileURLToPath(new URL("./quality-check.mjs", import.meta.url));
    await probe(process.execPath, [cli, "secrets"], "", false, /github-pat/u, {
      cwd: directory,
    });
    writeFileSync(file, "POSTGRES_PASSWORD=inside\n");
    const collision = join(directory, "quality-findings.json");
    const collisionContent = JSON.stringify({ token });
    writeFileSync(collision, collisionContent);
    await probe(process.execPath, [cli, "secrets"], "", false, /github-pat/u, {
      cwd: directory,
    });
    assert.equal(readFileSync(collision, "utf8"), collisionContent);
    rmSync(collision);
    await probe(
      process.execPath,
      [cli, "secrets"],
      "",
      true,
      /Tracked-source secret scan passed/u,
      { cwd: directory },
    );
    /** @param {string[]} arguments_ */
    const git = async (arguments_) => {
      const result = await qualityCommand(
        "git",
        [
          "-C",
          directory,
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Quality proof",
          "-c",
          "user.email=quality@example.invalid",
          ...arguments_,
        ],
        { timeout: 5_000 },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    await git(["add", "."]);
    await git(["commit", "-qm", "clean base"]);
    const base = await git(["rev-parse", "HEAD"]);
    writeFileSync(file, "POSTGRES_PASSWORD=inside-local\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "clean change"]);
    await probe(process.execPath, [cli, "secrets"], "", true, undefined, {
      cwd: directory,
      base,
    });
    // Public disposable PostgreSQL identity, assembled to keep the proof itself scan-clean.
    const password = ["tracking", "fixture"].join("_");
    const changedPassword = ["Z8pn3V", "q1Lm7R", "s5Dx9H"].join("");
    const uri = (/** @type {string} */ value) =>
      `postgresql://tracking:${value}@127.0.0.1:15432/tracking`;
    const fixtureSources = [
      "scripts/observability-tracking-storage/producer.mjs",
      "scripts/observability-tracking-storage/producer_phase_contract.py",
      "scripts/observability-waitlist-storage/producer.mjs",
      "scripts/observability-tracking-storage/ownership.py",
    ];
    /** @param {string} source @param {string} value */
    const fixtureContent = (source, value) => {
      const original = readFileSync(
        new URL(`../${source}`, import.meta.url),
        "utf8",
      )
        .split("\n")
        .find((line) =>
          line.includes(
            source.endsWith("ownership.py")
              ? "POSTGRES_PASSWORD"
              : uri(password),
          ),
        );
      assert.ok(
        original,
        "the real disposable fixture must supply its credential boundary",
      );
      return `${original.replaceAll(password, value)}\n`;
    };
    /** @param {string} source @param {string} content */
    const writeFixture = (source, content) => {
      const target = join(directory, source);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    };
    for (const source of fixtureSources)
      writeFixture(source, fixtureContent(source, password));
    await probe(process.execPath, [cli, "secrets"], "", true, undefined, {
      cwd: directory,
    });
    await git(["add", "."]);
    await git(["commit", "-qm", "public disposable fixtures"]);
    for (const source of fixtureSources) rmSync(join(directory, source));
    await git(["add", "."]);
    await git(["commit", "-qm", "remove disposable fixtures"]);
    await probe(process.execPath, [cli, "secrets"], "", true, undefined, {
      cwd: directory,
      base,
    });
    for (const source of fixtureSources) {
      const diagnostic = source.endsWith("ownership.py")
        ? /generic-password/u
        : /generic-credential-uri/u;
      const negativeBase = await git(["rev-parse", "HEAD"]);
      writeFixture(source, fixtureContent(source, changedPassword));
      await probe(process.execPath, [cli, "secrets"], "", false, diagnostic, {
        cwd: directory,
      });
      await git(["add", "."]);
      await git(["commit", "-qm", "different synthetic credential"]);
      rmSync(join(directory, source));
      await git(["add", "."]);
      await git(["commit", "-qm", "remove different credential"]);
      await probe(process.execPath, [cli, "secrets"], "", false, diagnostic, {
        cwd: directory,
        base: negativeBase,
      });
      writeFixture(source, `GITHUB_TOKEN=${token}\n`);
      await probe(
        process.execPath,
        [cli, "secrets"],
        "",
        false,
        /github-pat/u,
        {
          cwd: directory,
        },
      );
      rmSync(join(directory, source));
      if (!source.endsWith("ownership.py")) {
        writeFixture(
          source,
          fixtureContent(source, password).replace("127.0.0.1", "127.0.0.2"),
        );
        await probe(process.execPath, [cli, "secrets"], "", false, diagnostic, {
          cwd: directory,
        });
        rmSync(join(directory, source));
      }
      const lookalike = `nested/${source}`;
      writeFixture(lookalike, fixtureContent(source, password));
      await probe(process.execPath, [cli, "secrets"], "", false, diagnostic, {
        cwd: directory,
      });
      rmSync(join(directory, lookalike));
    }
    writeFileSync(file, `GITHUB_TOKEN=${token}\n`);
    await git(["add", "."]);
    await git(["commit", "-qm", "synthetic provider key"]);
    writeFileSync(file, "POSTGRES_PASSWORD=inside\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "remove synthetic key"]);
    await probe(process.execPath, [cli, "secrets"], "", false, /github-pat/u, {
      cwd: directory,
      base,
    });
    await probe(
      process.execPath,
      [cli, "secrets"],
      "",
      false,
      /Secret scanner/u,
      { cwd: directory, base: "f".repeat(40) },
    );
  });
  if (process.argv[2] !== "secrets") {
    const manifest = join(directory, "package.json");
    const args = [
      "exec",
      "knip",
      "--directory",
      directory,
      "--include=dependencies,unlisted",
      "--no-progress",
    ];
    writeFileSync(join(directory, "index.js"), "export const used = true;\n");
    writeFileSync(
      manifest,
      JSON.stringify({ name: "quality-proof", private: true }),
    );
    await probe("pnpm", args, "", true);
    writeFileSync(
      manifest,
      JSON.stringify({
        name: "quality-proof",
        private: true,
        dependencies: { "left-pad": "1.3.0" },
      }),
    );
    await probe("pnpm", args, "", false, /left-pad/u);
    await withPinnedTool("shellcheck", async (executable) => {
      await probe(
        executable,
        ["--severity=warning", "-"],
        '#!/bin/sh\nprintf "%s\\n" "$1"\n',
        true,
      );
      await probe(
        executable,
        ["--severity=warning", "-"],
        '#!/bin/sh\nif [ "$1" -eq ]; then :; fi\n',
        false,
        /SC[0-9]+/u,
      );
    });
    await withPinnedTool("hadolint", async (executable) => {
      await probe(
        executable,
        ["--failure-threshold=warning", "-"],
        "FROM scratch\nCOPY file /file\nUSER 1000\n",
        true,
      );
      await probe(
        executable,
        ["--failure-threshold=warning", "-"],
        "FROM node:latest\n",
        false,
        /DL3007/u,
      );
    });
    await withPinnedTool("jactionlint", async (executable) => {
      const args = [
        "--profile=correctness",
        "--no-online",
        "--strict-exit",
        "--shellcheck=",
        "--pyflakes=",
        "-",
      ];
      const workflow =
        "name: Proof\non: push\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo passed\n";
      await probe(executable, args, workflow, true);
      await probe(
        executable,
        args,
        workflow.replace("    runs-on:", "    needs: missing\n    runs-on:"),
        false,
        /missing/u,
      );
    });
  }
  console.log("Quality tool positive and negative CLI proofs passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
