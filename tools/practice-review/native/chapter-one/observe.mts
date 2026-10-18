import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { docker } from "./process.mjs";

/** Execute outside the reviewing agent and retain actual command outcomes, including failures. */
export async function observeProject(
  project: string,
  runId: string,
  commit: string,
  signal: AbortSignal,
  image: string,
  leaseId: string,
) {
  const compose = [
    "compose",
    "-p",
    `inside-chapter-fixture-${runId}`,
    "-f",
    join(project, "compose.yaml"),
  ];
  const evidence: {
    command: string;
    code: number | null;
    stdout: string;
    stderr: string;
  }[] = [];
  const record = async (args: string[], shown: string) => {
    const result = await docker(args, {
      signal,
      acceptFailure: true,
      timeoutMs: 120_000,
    });
    evidence.push({ command: shown, ...result });
    return result;
  };
  const start = async () => {
    const started = await docker(
      [...compose, "up", "-d", "--build", "--wait", "--wait-timeout", "90"],
      { signal, timeoutMs: 180_000 },
    );
    evidence.push({
      command:
        "docker compose up -d --build --wait (fresh disposable stack; output tail)",
      ...started,
      stdout: started.stdout.slice(-2000),
      stderr: started.stderr.slice(-2000),
    });
    await record(
      [...compose, "ps", "--format", "json"],
      "docker compose ps --format json: readiness, services and published addresses",
    );
    const published = await record(
      [...compose, "port", "frontend", "8080"],
      "docker compose port frontend 8080",
    );
    const address = z
      .string()
      .regex(/^127\.0\.0\.1:[1-9][0-9]{0,4}$/u)
      .parse(published.stdout.trim());
    for (const path of ["/", "/api/health"]) {
      const response = await fetch(`http://${address}${path}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      const body = await response.text();
      const healthy =
        path === "/"
          ? body.includes('<main id="app">')
          : z
              .object({
                status: z.literal("ready"),
                database: z.literal("connected"),
              })
              .safeParse(JSON.parse(body)).success;
      evidence.push({
        command: `host GET http://${address}${path}`,
        code: response.ok && healthy ? 0 : 1,
        stdout: body.slice(0, 2000),
        stderr: "",
      });
    }
  };
  try {
    await start();
    await record(
      [...compose, "exec", "-T", "backend", "npm", "run", "test:integration"],
      "docker compose exec backend npm run test:integration",
    );
    await record(
      [...compose, "exec", "-T", "frontend", "npm", "run", "test:e2e"],
      "docker compose exec frontend npm run test:e2e",
    );
    await record(
      [...compose, "exec", "-T", "frontend", "npm", "run", "check"],
      "documented: docker compose exec -T frontend npm run check",
    );
    // Formatting, types and build need a writable disposable project, never the read-only services.
    const local = [
      "run",
      "--rm",
      "--label",
      `inside.chapter-lab=${leaseId}`,
      "--network",
      `inside-chapter-fixture-${runId}_default`,
      "-e",
      "BACKEND_URL=http://backend:8081",
      "-e",
      "FRONTEND_URL=http://frontend:8080",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--mount",
      `type=bind,src=${project},dst=/project`,
      image,
    ];
    await record([...local, "npm", "run", "check"], "npm run check");
    await record([...local, "npm", "run", "test:unit"], "npm run test:unit");
    const forbidden = join(project, "apps/frontend/forbidden.mjs");
    try {
      await writeFile(forbidden, "import '../backend/health.mjs';\n");
      await record(
        [...local, "npm", "run", "check"],
        "npm run check with a temporary forbidden frontend-to-backend import (outside the reviewed commit)",
      );
    } finally {
      await rm(forbidden, { force: true });
    }
    await docker([
      ...compose,
      "down",
      "--volumes",
      "--remove-orphans",
      "--rmi",
      "local",
    ]);
    await start();
    await record(
      [...compose, "exec", "-T", "backend", "npm", "run", "test:integration"],
      "clean restart: docker compose exec backend npm run test:integration",
    );
    await record(
      [...compose, "exec", "-T", "frontend", "npm", "run", "test:e2e"],
      "clean restart: docker compose exec frontend npm run test:e2e",
    );
  } finally {
    await docker([
      ...compose,
      "down",
      "--volumes",
      "--remove-orphans",
      "--rmi",
      "local",
    ]);
  }
  await mkdir(join(project, "evidence"), { recursive: true });
  await writeFile(
    join(project, "evidence/local-run.json"),
    JSON.stringify(
      {
        commit,
        source:
          "Outside runner, real disposable Compose services and Chromium; not GitHub CI or independent author review.",
        commands: evidence,
        limitations: [
          "No remote repository, GitHub Issues, labels, PR, CI or merge proof.",
          "Only local technical health path is exercised; no business feature is required.",
        ],
      },
      null,
      2,
    ),
  );
  return evidence;
}
