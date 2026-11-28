// @ts-check
// The light preview of a lesson or Task page from local files (#2221): the site's own Reader and
// Task page components over a Content package, with no backend, database, Docker or sign-in.
// Contract: docs/runbooks/file-preview.md.
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { z } from "zod";
import {
  openPreview,
  previewAsset,
  previewIndex,
  previewMaterial,
  previewTask,
} from "../../../tools/authoring/file-preview.mjs";

/** @typedef {import("../../../tools/authoring/file-preview.mjs").Preview} Preview */
/** @typedef {import("node:http").ServerResponse} Response */

const usage = `Usage: pnpm preview:files --package PATH [--port N]

Shows lessons and Task pages of a Content package as sachkov.dev renders them, and reloads the page
when the package changes. PATH is a package.json, a package directory, or the folder Course Studio
exports packages into; in a folder the most recently written package wins.

--port  Port on 127.0.0.1; 0 takes any free port. Without it the preview takes 4400 or the
        next free port.

The first line of output is the preview address: "Preview: http://127.0.0.1:PORT/".`;

const defaultPort = 4400;
/** Only this machine reaches the preview: it serves the package files and an author's session. */
const host = "127.0.0.1";
/** The account of the preview reader; no account exists behind it. */
const previewAccountId = "00000000-0000-4000-8000-000000002221";
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const previewRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * One package source: the current preview or the reason it does not load. Each change of the
 * package reopens it, so a page reload shows the files as they are now.
 * @param {string} path
 */
function packageSource(path) {
  /** @type {Promise<{ readonly preview: Preview } | { readonly error: string }>} */
  let current = load();
  function load() {
    return openPreview(path).then(
      (preview) => ({ preview }),
      (/** @type {unknown} */ error) => ({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return {
    current: () => current,
    reload() {
      current = load();
      return current;
    },
  };
}

/**
 * @param {Response} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

/**
 * The page a reader address shows: a lesson, a Task page, or the package contents.
 * @param {Preview} preview
 * @param {string} pathname
 */
async function pageAt(preview, pathname) {
  const material = /^\/materials\/([^/]+)\/?$/u.exec(pathname)?.[1];
  const task = /^\/products\/[^/]+\/tasks\/([^/]+)\/?$/u.exec(pathname)?.[1];
  const page =
    material !== undefined
      ? await previewMaterial(preview, decodeURIComponent(material))
      : task !== undefined
        ? await previewTask(preview, decodeURIComponent(task))
        : null;
  if (page !== null) return page;
  return {
    kind: material === undefined && task === undefined ? "index" : "missing",
    index: previewIndex(preview),
  };
}

/**
 * The state of each asked Material for a reader who has studied and saved nothing, by the route
 * the Reader asks.
 * @type {Readonly<Record<string, (materialId: string) => object>>}
 */
const emptyStates = {
  "/api/reading-progress/states": (materialId) => ({
    materialId,
    isRead: false,
    readAt: null,
    updatedAt: null,
    version: 0,
    updateNote: null,
    openedParts: null,
  }),
  "/api/bookmarks/states": (materialId) => ({
    materialId,
    bookmarked: false,
    bookmarkedAt: null,
  }),
};

/**
 * Answers the requests the Reader makes to Platform: its page data, the package's image files, the
 * sign-in state and the reading and bookmark states of a reader who has studied and saved nothing.
 * Any other API request gets 404, as an unavailable backend would answer.
 * @param {ReturnType<typeof packageSource>} source
 * @returns {import("vite").Plugin}
 */
function previewApi(source) {
  return {
    name: "inside-file-preview",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://preview.invalid");
        if (url.pathname === "/__preview/page") {
          const loaded = await source.current();
          if ("error" in loaded)
            return sendJson(response, 200, {
              kind: "error",
              message: loaded.error,
            });
          try {
            return sendJson(
              response,
              200,
              await pageAt(loaded.preview, url.searchParams.get("path") ?? "/"),
            );
          } catch (error) {
            return sendJson(response, 200, {
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const asset =
          /^\/api\/materials\/[^/]+\/assets\/([^/]+)\/images(?:\/\d+)?$/u.exec(
            url.pathname,
          )?.[1] ??
          /^\/api\/products\/[^/]+\/tasks\/[^/]+\/assets\/([^/]+)$/u.exec(
            url.pathname,
          )?.[1];
        if (asset !== undefined) {
          const loaded = await source.current();
          const file =
            "preview" in loaded
              ? previewAsset(loaded.preview, decodeURIComponent(asset))
              : null;
          if (file === null) return sendJson(response, 404, {});
          response.setHeader("content-type", file.mimeType);
          response.setHeader("cache-control", "no-store");
          createReadStream(file.path)
            .on("error", () => {
              if (!response.headersSent) response.statusCode = 404;
              response.end();
            })
            .pipe(response);
          return;
        }
        // The shell reads the sign-in state: the preview reader is a signed-in author, as the owner
        // is on the stand.
        if (url.pathname === "/auth/status")
          return sendJson(response, 200, {
            state: "authenticated",
            accountId: previewAccountId,
            canManageMaterials: true,
          });
        const emptyState =
          request.method === "POST" && Object.hasOwn(emptyStates, url.pathname)
            ? emptyStates[url.pathname]
            : undefined;
        if (emptyState !== undefined)
          return sendJson(response, 200, {
            kind: "ready",
            states: (await readMaterialIds(request)).map(emptyState),
          });
        if (
          url.pathname.startsWith("/api/") ||
          url.pathname.startsWith("/auth/")
        )
          return sendJson(response, 404, {});
        next();
      });
    },
  };
}

const stateRequestSchema = z.object({ materialIds: z.array(z.string()) });

/**
 * The Material IDs a state request names; anything else names none.
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<string[]>}
 */
async function readMaterialIds(request) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  for await (const chunk of request)
    chunks.push(
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : z.instanceof(Uint8Array).parse(chunk),
    );
  try {
    const body = stateRequestSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    return body.success ? body.data.materialIds : [];
  } catch {
    return [];
  }
}

/**
 * Starts the preview and resolves with its address once it listens.
 * @param {{ readonly packagePath: string; readonly port?: number | undefined }} options
 */
async function startFilePreview({ packagePath, port }) {
  const watched = resolve(packagePath);
  const source = packageSource(watched);
  const loaded = await source.current();
  const server = await createServer({
    configFile: false,
    root: previewRoot,
    // Tests run their own preview beside the author's, each with its own prebundled dependencies.
    cacheDir:
      process.env["INSIDE_FILE_PREVIEW_CACHE_DIR"] ??
      resolve(webRoot, "node_modules/.vite/file-preview"),
    appType: "spa",
    logLevel: "warn",
    clearScreen: false,
    server: {
      host,
      port: port ?? defaultPort,
      strictPort: port !== undefined,
      // The package lies outside the Web app; only the preview's own modules are served from disk.
      fs: {
        strict: true,
        allow: [webRoot, resolve(webRoot, "../../node_modules")],
      },
    },
    css: { postcss: webRoot },
    oxc: { jsx: { runtime: "automatic" } },
    resolve: {
      // Stand-ins for what needs Next.js or a server: the router, telemetry and the video player.
      alias: [
        {
          find: /^@\/features\/material-video$/u,
          replacement: resolve(previewRoot, "material-video.tsx"),
        },
        { find: "@", replacement: resolve(webRoot, "src") },
        {
          find: "next/link",
          replacement: resolve(previewRoot, "next-link.tsx"),
        },
        {
          find: "next/navigation",
          replacement: resolve(previewRoot, "next-navigation.ts"),
        },
        {
          find: "next/web-vitals",
          replacement: resolve(previewRoot, "next-web-vitals.ts"),
        },
        {
          find: "server-only",
          replacement: resolve(previewRoot, "server-only.ts"),
        },
      ],
    },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [previewApi(source)],
  });
  /** @type {NodeJS.Timeout | undefined} */
  let pending;
  const changed = (/** @type {string} */ path) => {
    if (path !== watched && !path.startsWith(`${watched}/`)) return;
    clearTimeout(pending);
    // Course Studio writes a package as several files and a rename: reload once it settles.
    pending = setTimeout(() => {
      void source.reload().then((next) => {
        if ("error" in next) process.stderr.write(`Preview: ${next.error}\n`);
        server.ws.send({ type: "full-reload" });
      });
    }, 150);
  };
  server.watcher.add(watched);
  server.watcher.on("all", (_event, path) => changed(resolve(path)));
  await server.listen();
  const address = server.httpServer?.address();
  const listening =
    typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${host}:${String(listening)}/`;
  return {
    url,
    initialError: "error" in loaded ? loaded.error : undefined,
    close: () => server.close(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      package: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || values.package === undefined) {
    process.stdout.write(`${usage}\n`);
    process.exit(values.help ? 0 : 2);
  }
  const port =
    values.port === undefined ? undefined : Number.parseInt(values.port, 10);
  if (port !== undefined && !(Number.isInteger(port) && port >= 0)) {
    process.stderr.write(`Preview: invalid --port ${String(values.port)}\n`);
    process.exit(2);
  }
  const preview = await startFilePreview({
    packagePath: resolve(
      process.env["INIT_CWD"] ?? process.cwd(),
      values.package,
    ),
    port,
  });
  process.stdout.write(`Preview: ${preview.url}\n`);
  if (preview.initialError !== undefined)
    process.stderr.write(`Preview: ${preview.initialError}\n`);
  const stop = () => {
    void preview.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
