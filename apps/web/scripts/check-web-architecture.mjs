// @ts-check
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { z } from "zod";

import { parseSync, Visitor } from "oxc-parser";

/**
 * @typedef {import("oxc-parser").Program} Program
 * @typedef {import("oxc-parser").Statement} Statement
 * @typedef {import("oxc-parser").Function | import("oxc-parser").ArrowFunctionExpression} FunctionNode
 * @typedef {import("oxc-parser").Node} AstNode
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const requestedRoots = process.argv.slice(2);
const scanRoots = (
  requestedRoots.length === 0 ? ["src", "app", "proxy.ts"] : requestedRoots
).map((root) => path.resolve(webRoot, root));
const backendOperationPaths = new Set(
  Object.keys(
    z
      .object({ paths: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(
        JSON.parse(
          readFileSync(
            path.resolve(webRoot, "../backend/openapi/platform-api.json"),
            "utf8",
          ),
        ),
      ).paths,
  ),
);
const backendOperationPathPatterns = [...backendOperationPaths].map(
  (operationPath) =>
    new RegExp(
      `${operationPath
        .split(/(\{[^}]+\})/u)
        .map((part) =>
          /^\{[^}]+\}$/u.test(part) ? "[^/]+" : escapeRegExp(part),
        )
        .join("")}$`,
      "u",
    ),
);
/**
 * Kits that declare the material document block set. `@inside/material-blocks` owns them, so an
 * application that imports one is declaring blocks a second time.
 */
const documentBlockKitSpecifiers = new Set([
  "@tiptap/extension-table",
  "@tiptap/extension-unique-id",
  "@tiptap/starter-kit",
]);
/** Entry points that must stay free of the editor bundle. */
const editorFreeRouteEntries = [
  "app/(public)/(catalog)/materials/[slug]/page.tsx",
  "app/authoring/materials/page.tsx",
  "app/authoring/playlists/page.tsx",
  "app/authoring/playlists/[seriesId]/page.tsx",
];
const runtimeConfigurationNames = new Set([
  "BACKEND_BASE_URL",
  "LOGTO_ENDPOINT",
  "LOGTO_AUDIENCE",
  "LOGTO_APP_ID",
  "LOGTO_APP_SECRET",
  "LOGTO_COOKIE_SECRET",
  "NODE_ENV",
  "WEB_BASE_URL",
]);
/**
 * Mutations that still encode FormData by hand (#1679). The list only shrinks: a new mutation
 * declares its operation with `defineMutationOperation` and serves it with
 * `handleMutationOperation` (ADR 0038).
 */
const formMutationModulesAwaitingOperations = new Set([
  "src/_pages/account/api/account-profile-route.server.ts",
  "src/_pages/account/api/account-telegram-link-route.server.ts",
  "src/_pages/communications/api/broadcasts.browser.ts",
  "src/_pages/communications/api/communications-route.server.ts",
  "src/_pages/communications/api/communications.browser.ts",
  "src/_pages/communications/api/communications.server.ts",
  "src/_pages/content-collections/api/content-collections-route.server.ts",
  "src/_pages/content-collections/api/content-collections.browser.ts",
  "src/_pages/library-discovery/api/product-waitlist-route.server.ts",
  "src/_pages/task-submissions/api/save-author-feedback-route.server.ts",
  "src/_pages/task-submissions/api/save-author-feedback.browser.ts",
  "src/entities/subscription/api/billing-consents.browser.ts",
  "src/entities/subscription/api/billing-consents.server.ts",
  "src/features/account-access/api/begin-telegram-link.browser.ts",
  "src/features/account-access/api/confirm-telegram-link.browser.ts",
  "src/features/account-email/api/account-email.browser.ts",
  "src/features/account-email/api/account-email.server.ts",
  "src/features/billing-admin/api/access.browser.ts",
  "src/features/billing-admin/api/billing-admin.browser.ts",
  "src/features/billing-admin/api/billing-admin.server.ts",
  "src/features/billing-admin/api/enrollments.browser.ts",
  "src/features/billing-admin/api/enrollments.server.ts",
  "src/features/billing-admin/api/invitations.browser.ts",
  "src/features/billing-admin/api/payment-links.browser.ts",
  "src/features/billing-admin/api/product-revocation.browser.ts",
  "src/features/billing-admin/api/product-revocation.server.ts",
  "src/features/billing-admin/api/respondents.browser.ts",
  "src/features/billing-admin/api/tribute.browser.ts",
  "src/features/billing-admin/api/tribute.server.ts",
  "src/features/billing-checkout/api/billing-checkout.browser.ts",
  "src/features/billing-checkout/api/billing-checkout.server.ts",
  "src/features/billing-contact/api/billing-contact.browser.ts",
  "src/features/billing-contact/api/billing-contact.server.ts",
  "src/features/billing-subscription/api/billing-subscription.browser.ts",
  "src/features/billing-subscription/api/billing-subscription.server.ts",
  "src/features/bookmarks/api/bookmarks-route.server.ts",
  "src/features/bookmarks/api/bookmarks.browser.ts",
  "src/features/material-lifecycle/api/delete-material-draft-route.server.ts",
  "src/features/material-lifecycle/api/delete-material-draft.browser.ts",
  "src/features/material-lifecycle/api/transition-material-publication-route.server.ts",
  "src/features/material-lifecycle/api/transition-material-publication.browser.ts",
  "src/features/material-video/api/video-authoring-route.server.ts",
  "src/features/material-video/api/video-authoring.browser.ts",
  "src/features/material-video/api/video-playback-route.server.ts",
  "src/features/material-video/api/video-playback.browser.ts",
  "src/features/member-profile-editor/api/create-member-profile.browser.ts",
  "src/features/member-profile-editor/api/update-member-profile.browser.ts",
  "src/features/notification-preferences/api/notification-preferences.browser.ts",
  "src/features/notification-preferences/api/notification-preferences.server.ts",
  "src/features/product-artifacts/api/product-artifacts-bff.server.ts",
  "src/features/product-artifacts/api/product-artifacts.browser.ts",
  "src/features/product-community-settings/api/configuration.browser.ts",
  "src/features/product-community-settings/api/configuration.server.ts",
  "src/features/product-modes/api/product-mode-route.server.ts",
  "src/features/product-modes/api/product-mode.browser.ts",
  "src/features/product-task-submission/api/submit-product-task-route.server.ts",
  "src/features/product-task-submission/api/submit-product-task.browser.ts",
  "src/features/product-waitlist/api/product-waitlist.browser.ts",
  "src/features/reading-progress/api/material-open-route.server.ts",
  "src/features/reading-progress/api/material-open.browser.ts",
  "src/features/reading-progress/api/personal-home-route.server.ts",
  "src/features/reading-progress/api/personal-home.browser.ts",
  "src/features/reading-progress/api/reading-route.server.ts",
  "src/features/reading-progress/api/reading.browser.ts",
  "src/features/reading-progress/api/series-continuation.browser.ts",
  "src/features/reading-progress/api/series-continuation.server.ts",
  "src/features/series-order/api/chapter-attachments.browser.ts",
  "src/features/series-order/api/chapter-attachments.server.ts",
  "src/features/series-order/api/home-pin-route.server.ts",
  "src/features/series-order/api/home-pin.browser.ts",
  "src/features/series-order/api/series-order-route.server.ts",
  "src/features/series-order/api/series-order.browser.ts",
  "src/features/terms-acceptance/api/accept-terms-route.server.ts",
  "src/features/terms-acceptance/api/accept-terms.browser.ts",
]);
/**
 * Browser writes that cannot travel as one JSON operation body: binary uploads with their paired
 * removal and delivery reports sent by `sendBeacon` (ADR 0038).
 */
const directBrowserWriteModules = new Set([
  "src/_pages/account/api/profile-avatar-mutation.browser.ts",
  "src/features/client-telemetry/api/client-telemetry.browser.ts",
  "src/features/content-covers/api/change-content-cover.browser.ts",
]);
/** Generated by `next typegen`; type-aware lint runs before it on a clean checkout. */
const generatedRouteTypes = new Set(["PageProps", "LayoutProps"]);
/** Site animation is a CSS component beside its page (owner decision of 2026-09-11). */
const siteAnimationPackages =
  /^(?:remotion|@remotion\/.+|framer-motion|motion(?:\/.+)?)$/u;

/**
 * @param {string} root
 * @returns {string[]}
 */
function sourceFiles(root) {
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:cts|mts|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

/** @param {string} file */
function scannedPath(file) {
  return path.relative(webRoot, file).split(path.sep).join("/");
}

/** @param {Program} program */
function moduleSpecifiers(program) {
  /** @type {string[]} */
  const specifiers = [];
  new Visitor({
    ImportDeclaration(node) {
      if (typeof node.source.value === "string")
        specifiers.push(node.source.value);
    },
    ExportAllDeclaration(node) {
      if (typeof node.source.value === "string")
        specifiers.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (typeof node.source?.value === "string")
        specifiers.push(node.source.value);
    },
  }).visit(program);
  return specifiers;
}

/** @param {Program} program */
function declaresMain(program) {
  let found = false;
  new Visitor({
    JSXOpeningElement(node) {
      if (node.name.type === "JSXIdentifier" && node.name.name === "main")
        found = true;
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function stringLiterals(program) {
  /** @type {string[]} */
  const values = [];
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string") values.push(node.value);
    },
    TemplateLiteral(node) {
      if (node.expressions.length === 0) {
        values.push(
          node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "",
        );
      }
    },
  }).visit(program);
  return values;
}

/** @param {Program} program */
function hasUseClientDirective(program) {
  for (const statement of program.body) {
    if (
      statement.type === "ExpressionStatement" &&
      statement.directive !== null
    ) {
      if (statement.directive === "use client") return true;
      continue;
    }
    break;
  }
  return false;
}

/**
 * @param {Program} program
 * @param {string} directive
 */
function hasDirective(program, directive) {
  return program.body.some(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      statement.directive === directive,
  );
}

/**
 * `"use cache"` и его варианты: `"use cache: private"`, `"use cache: remote"`.
 *
 * @param {Statement} statement
 * @returns {statement is import("oxc-parser").ExpressionStatement & { directive: string }}
 */
function isCacheDirective(statement) {
  return (
    statement.type === "ExpressionStatement" &&
    typeof statement.directive === "string" &&
    statement.directive.startsWith("use cache")
  );
}

/**
 * Кеш-директивы файла: на уровне модуля и внутри функций. Общий кеш держит только гостевое чтение
 * каталога (ADR 0027), поэтому искать приходится и во вложенных телах.
 *
 * @param {Program} program
 */
function cacheDirectives(program) {
  /** @type {string[]} */
  const directives = [];
  new Visitor({
    ExpressionStatement(node) {
      if (isCacheDirective(node)) directives.push(node.directive);
    },
  }).visit(program);
  return directives;
}

/**
 * Политика кеша принадлежит функции, а не файлу: у второго кешированного чтения в том же модуле без
 * неё не было бы ни тега, ни срока, и авторская запись его бы не сбросила.
 *
 * @param {Program} program
 */
function hasCachedReadWithoutPolicy(program) {
  let found = false;
  /** @param {FunctionNode} node */
  const check = (node) => {
    if (
      node.body?.type !== "BlockStatement" ||
      !node.body.body.some(isCacheDirective)
    )
      return;
    // The visitor walks a program's statements, so the function's own statements form one.
    if (
      !namesIdentifier(
        { ...program, body: node.body.body },
        "applyCatalogCachePolicy",
      )
    )
      found = true;
  };
  new Visitor({
    ArrowFunctionExpression: check,
    FunctionDeclaration: check,
    FunctionExpression: check,
  }).visit(program);
  return found;
}

/**
 * Именованный импорт под своим именем: переименованный или чужой одноимённый правило не выполняет.
 *
 * @param {Program} program
 * @param {string} source
 * @param {string} name
 */
function importsNamed(program, source, name) {
  return program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      statement.source.value === source &&
      statement.specifiers.some(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          specifier.imported.type === "Identifier" &&
          specifier.imported.name === name &&
          specifier.local.name === name,
      ),
  );
}

/**
 * @param {Program} program
 * @param {string} name
 */
function namesIdentifier(program, name) {
  let seen = false;
  new Visitor({
    Identifier(node) {
      if (node.name === name) seen = true;
    },
  }).visit(program);
  return seen;
}

/** @param {string} specifier */
function importsTheSession(specifier) {
  return specifier.includes("shared/auth") || specifier === "next/headers";
}

/**
 * Модуль с кеш-директивой не должен видеть сессию: ни токена, ни cookie, ни модуля входа. Проверка
 * ловит прямое нарушение; токен под другим именем или сессия через посредника остаются делом
 * обзора — их не отличить от обычного кода по форме.
 *
 * @param {Program} program
 */
function seesTheSession(program) {
  return (
    namesIdentifier(program, "accessToken") ||
    moduleSpecifiers(program).some(importsTheSession)
  );
}

/**
 * `proxy` решает только по тому, что web знает сам (ADR 0027, «Настоящий 404 до начала ответа»).
 *
 * @param {string} specifier
 */
function reachesRequestTimeDependency(specifier) {
  return (
    importsTheSession(specifier) ||
    specifier.includes("shared/api/backend") ||
    specifier.startsWith("@logto/")
  );
}

/**
 * Сессия и сеть без импорта: обращение к `.cookies` и вызов `fetch`. Cookie из сырого заголовка
 * остаётся делом обзора — по форме это обычное чтение заголовка.
 *
 * @param {Program} program
 */
function readsCookiesOrFetches(program, allowedCookieName = "") {
  let found = false;
  let cookieAccesses = 0;
  let allowedCookieAccesses = 0;
  new Visitor({
    MemberExpression(node) {
      if (memberPropertyName(node) === "cookies") cookieAccesses += 1;
    },
    CallExpression(node) {
      const callee = node.callee;
      if (
        allowedCookieName !== "" &&
        callee.type === "MemberExpression" &&
        ["get", "set"].includes(memberPropertyName(callee) ?? "") &&
        callee.object.type === "MemberExpression" &&
        memberPropertyName(callee.object) === "cookies" &&
        node.arguments[0]?.type === "Literal" &&
        node.arguments[0].value === allowedCookieName
      )
        allowedCookieAccesses += 1;
      if (
        (callee.type === "Identifier" && callee.name === "fetch") ||
        (callee.type === "MemberExpression" &&
          memberPropertyName(callee) === "fetch")
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found || cookieAccesses > allowedCookieAccesses;
}

/**
 * Обходит модули, до которых дотягивается `entry`, и отдаёт каждый вместе с его программой.
 *
 * @param {string} entry
 */
function reachableModules(entry) {
  /** @type {Set<string>} */
  const visited = new Set();
  const pending = [entry];
  /** @type {{ file: string; program: Program }[]} */
  const reached = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const program = parsedFiles.get(file);
    if (program === undefined) continue;
    reached.push({ file, program });
    for (const specifier of moduleSpecifiers(program)) {
      const dependency = resolveLocalModule(file, specifier, parsedFiles);
      if (dependency !== undefined) pending.push(dependency);
    }
  }
  return reached;
}

/**
 * Статичные по замыслу `GET`-обработчики: их ответ не зависит ни от запроса, ни от среды. Тот же
 * перечень держит `check-prerendered-route-handlers.mjs`, который сверяет уже собранный манифест.
 */
const prerenderedRouteHandlers = ["app/(public)/social-card/route.tsx"];

/**
 * `GET`-обработчик, который не коснулся запроса до первого `return`, Next.js предсобирает при
 * сборке образа — без конфигурации и backend. Перехват исключений делает это незаметным: отказ от
 * предсборки приходит исключением, и `catch` выдаёт его за сбой зависимости, который застывает в
 * образе (ADR 0027). Поэтому обработчик объявлен в самом файле маршрута и начинается с
 * `await connection()`; переэкспорт допустим только из другого файла маршрута.
 *
 * @param {Program} program
 */
function getHandlerFinding(program) {
  for (const statement of program.body) {
    // `export *` может принести `GET` из модуля, который не начинает его с `connection()`.
    if (statement.type === "ExportAllDeclaration") return "declare";
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (
      declaration?.type === "FunctionDeclaration" &&
      declaration.id?.name === "GET"
    ) {
      const first = declaration.body?.body[0];
      const startsWithConnection =
        first?.type === "ExpressionStatement" &&
        first.expression.type === "AwaitExpression" &&
        first.expression.argument.type === "CallExpression" &&
        first.expression.argument.callee.type === "Identifier" &&
        first.expression.argument.callee.name === "connection";
      // Одноимённая функция из другого модуля правило не выполняет: нужна `connection` из Next.js.
      return startsWithConnection &&
        importsNamed(program, "next/server", "connection")
        ? undefined
        : "start";
    }
    if (
      declaration?.type === "VariableDeclaration" &&
      declaration.declarations.some(
        (entry) => entry.id.type === "Identifier" && entry.id.name === "GET",
      )
    ) {
      return "declare";
    }
    const exportsGet = statement.specifiers.some(
      (specifier) =>
        specifier.exported.type === "Identifier" &&
        specifier.exported.name === "GET",
    );
    if (exportsGet) {
      const source = statement.source?.value;
      return typeof source === "string" && /(?:^|\/)route$/u.test(source)
        ? undefined
        : "declare";
    }
  }
  return undefined;
}

/**
 * Импорты, которые остаются в собранном модуле. Стираются только `import type` и `export type`:
 * при `verbatimModuleSyntax` `import { type X }` остаётся как `import {}` и загружает модуль.
 *
 * @param {Program} program
 */
function valueModuleSpecifiers(program) {
  return program.body.flatMap((statement) => {
    if (statement.type === "ImportDeclaration") {
      return statement.importKind === "type" ? [] : [statement.source.value];
    }
    if (
      (statement.type === "ExportAllDeclaration" ||
        statement.type === "ExportNamedDeclaration") &&
      typeof statement.source?.value === "string" &&
      statement.exportKind !== "type"
    ) {
      return [statement.source.value];
    }
    return [];
  });
}

/**
 * Серверный интерфейс: пакет `server-only` или модуль `*.server`.
 *
 * @param {string} specifier
 */
function isServerInterface(specifier) {
  return (
    specifier === "server-only" || /\.server(?:\.[cm]?tsx?)?$/u.test(specifier)
  );
}

/** @param {string} sourcePath */
function isStorybookModule(sourcePath) {
  return (
    /(?:^|\/)src\/storybook\//u.test(sourcePath) ||
    /\.(?:stories|fixtures)\.[cm]?tsx?$/u.test(sourcePath) ||
    /\.test\.[cm]?tsx?$/u.test(sourcePath)
  );
}

/**
 * Каталог Storybook: его пакеты, его конфигурация, `src/storybook`, истории и fixtures. Импорт
 * типа тоже связывает производственный код с каталогом.
 *
 * @param {string} specifier
 */
function namesStorybookModule(specifier) {
  return /^(?:@storybook\/|storybook(?:\/|$))|(?:^|\/)\.?storybook(?:\/|$)|\.(?:stories|fixtures)$/u.test(
    specifier,
  );
}

/**
 * Сгенерированный тип маршрута появляется только после `next typegen`, а lint с проверкой типов
 * идёт раньше: маршрут объявляет типы `params` и `searchParams` сам.
 *
 * @param {Program} program
 */
function namesGeneratedRouteType(program) {
  /** Свой тип под тем же именем — ровно то, чего правило требует. */
  const ownTypes = new Set(
    program.body.flatMap((statement) => {
      const declaration =
        statement.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement;
      return declaration?.type === "TSTypeAliasDeclaration" ||
        declaration?.type === "TSInterfaceDeclaration"
        ? [declaration.id.name]
        : statement.type === "ImportDeclaration"
          ? statement.specifiers.map((specifier) => specifier.local.name)
          : [];
    }),
  );
  let found = false;
  new Visitor({
    TSTypeReference(node) {
      if (
        node.typeName.type === "Identifier" &&
        generatedRouteTypes.has(node.typeName.name) &&
        !ownTypes.has(node.typeName.name)
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * До `next typegen` `Route` — любая строка, после — объединение известных адресов. Утверждение о
 * вычисленном тексте проходит только в одном из двух состояний; литерал известного адреса — в обоих.
 *
 * @param {Program} program
 */
function assertsComputedRoute(program) {
  /** `Route` и его локальные имена: `import { Route as Href } from "next"`. */
  const routeNames = new Set(["Route"]);
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      (statement.source.value !== "next" &&
        statement.source.value !== "next/types")
    )
      continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        exportedName(specifier.imported) === "Route"
      ) {
        routeNames.add(specifier.local.name);
      }
    }
  }
  let found = false;
  /** @param {import("oxc-parser").TSAsExpression | import("oxc-parser").TSTypeAssertion} node */
  const check = (node) => {
    const type = node.typeAnnotation;
    if (type.type !== "TSTypeReference") return;
    const namesRoute =
      type.typeName.type === "Identifier"
        ? routeNames.has(type.typeName.name)
        : type.typeName.type === "TSQualifiedName" &&
          type.typeName.right.name === "Route";
    if (namesRoute && literalString(node.expression) === undefined) {
      found = true;
    }
  };
  new Visitor({ TSAsExpression: check, TSTypeAssertion: check }).visit(program);
  return found;
}

/**
 * @param {import("oxc-parser").ObjectPattern} pattern
 * @param {string} key
 */
function patternTakes(pattern, key) {
  return pattern.properties.some(
    (property) =>
      property.type === "Property" &&
      property.key.type === "Identifier" &&
      property.key.name === key,
  );
}

/**
 * Свойства, которые граница получает под именем `name`: `name.reset` или `const { reset } = name`.
 *
 * @param {Program} program
 * @param {string} name
 */
function bindingTakesReset(program, name) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        node.object.type === "Identifier" &&
        node.object.name === name &&
        memberPropertyName(node) === "reset"
      ) {
        found = true;
      }
    },
    VariableDeclarator(node) {
      if (
        node.id.type === "ObjectPattern" &&
        node.init?.type === "Identifier" &&
        node.init.name === name &&
        patternTakes(node.id, "reset")
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * Функция, которую модуль экспортирует по умолчанию: объявленная в самом экспорте или по имени.
 *
 * @param {Program} program
 */
function defaultExportedFunction(program) {
  for (const statement of program.body) {
    if (statement.type !== "ExportDefaultDeclaration") continue;
    const declaration = statement.declaration;
    if (declaration.type !== "Identifier") return declaration;
    for (const candidate of program.body) {
      if (
        candidate.type === "FunctionDeclaration" &&
        candidate.id?.name === declaration.name
      ) {
        return candidate;
      }
      if (candidate.type !== "VariableDeclaration") continue;
      for (const declarator of candidate.declarations) {
        if (
          declarator.id.type === "Identifier" &&
          declarator.id.name === declaration.name
        ) {
          return declarator.init;
        }
      }
    }
  }
  return undefined;
}

/**
 * Граница ошибки берёт `reset` из своих свойств: он перерисовывает тот же сбой без запроса.
 * Одноимённый сброс формы внутри границы правило не нарушает.
 *
 * @param {Program} program
 */
function takesResetProp(program) {
  const boundary = defaultExportedFunction(program);
  const props =
    boundary?.type === "FunctionDeclaration" ||
    boundary?.type === "ArrowFunctionExpression" ||
    boundary?.type === "FunctionExpression"
      ? boundary.params[0]
      : undefined;
  if (props?.type === "Identifier") {
    return bindingTakesReset(program, props.name);
  }
  if (props?.type !== "ObjectPattern") return false;
  if (patternTakes(props, "reset")) return true;
  const rest = props.properties.find(
    (property) => property.type === "RestElement",
  );
  return (
    rest?.type === "RestElement" &&
    rest.argument.type === "Identifier" &&
    bindingTakesReset(program, rest.argument.name)
  );
}

/**
 * Срок, на который браузер держит страницу в памяти. Next.js читает его только из литерала в файле
 * маршрута.
 *
 * @param {Program} program
 * @returns {"literal" | "computed" | undefined}
 */
function dynamicStaleTimeDeclaration(program) {
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.declaration?.type === "VariableDeclaration") {
      for (const declarator of statement.declaration.declarations) {
        if (
          declarator.id.type === "Identifier" &&
          declarator.id.name === "unstable_dynamicStaleTime"
        ) {
          return declarator.init?.type === "Literal" &&
            typeof declarator.init.value === "number"
            ? "literal"
            : "computed";
        }
      }
    }
    if (
      statement.specifiers.some(
        (specifier) =>
          exportedName(specifier.exported) === "unstable_dynamicStaleTime",
      )
    ) {
      return "computed";
    }
  }
  return undefined;
}

const layerRanks = new Map([
  ["shared", 0],
  ["entities", 1],
  ["features", 2],
  ["widgets", 3],
  ["_pages", 4],
  ["_app", 5],
  ["app", 5],
]);

/** @param {string} file */
function moduleLayer(file) {
  const segments = scannedPath(file).split("/");
  const sourceIndex = segments.lastIndexOf("src");
  const appIndex = segments.lastIndexOf("app");
  const layerIndex = sourceIndex >= 0 ? sourceIndex + 1 : appIndex;
  const layer = segments[layerIndex];
  const rank = layer === undefined ? undefined : layerRanks.get(layer);
  if (layer === undefined || rank === undefined) return undefined;
  const rawSlice = segments[layerIndex + 1] ?? "";
  return {
    layer,
    rank,
    slice: rawSlice.split(".")[0] ?? rawSlice,
  };
}

/**
 * @param {string} importer
 * @param {string} dependency
 */
function layerFinding(importer, dependency) {
  const source = moduleLayer(importer);
  const target = moduleLayer(dependency);
  if (source === undefined || target === undefined) return undefined;
  if (target.rank > source.rank) {
    return `${scannedPath(importer)}: ${source.layer} cannot import the upper ${target.layer} layer`;
  }
  if (
    source.layer === target.layer &&
    ["_pages", "widgets", "features", "entities"].includes(source.layer) &&
    source.slice !== target.slice
  ) {
    return `${scannedPath(importer)}: ${source.layer} slices cannot import each other (${source.slice} -> ${target.slice})`;
  }
  return undefined;
}

/** @param {Program} program */
function declaresDocumentNode(program) {
  /** @type {Set<string>} */
  const nodeBindings = new Set();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== "@tiptap/core"
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        exportedName(specifier.imported) === "Node"
      ) {
        nodeBindings.add(specifier.local.name);
      }
    }
  }

  let found = false;
  new Visitor({
    CallExpression(node) {
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        nodeBindings.has(node.callee.object.name) &&
        memberPropertyName(node.callee) === "create"
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function readsPublicSiteOrigin(program) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        memberPropertyName(node) === "baseUrl" &&
        node.object.type === "MemberExpression" &&
        memberPropertyName(node.object) === "identity"
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function readsBackendEndpointEnvironment(program) {
  return readsProcessEnvironment(program, isBackendEndpointName);
}

/** @param {Program} program */
function readsRuntimeConfigurationEnvironment(program) {
  return readsProcessEnvironment(program, (name) =>
    runtimeConfigurationNames.has(name),
  );
}

/**
 * @param {Program} program
 * @param {(name: string) => boolean} matchesName
 */
function readsProcessEnvironment(program, matchesName) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        node.object.type === "MemberExpression" &&
        node.object.object.type === "Identifier" &&
        node.object.object.name === "process" &&
        memberPropertyName(node.object) === "env" &&
        matchesName(memberPropertyName(node))
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {string} name */
function isBackendEndpointName(name) {
  return (
    name === "BACKEND_BASE_URL" ||
    /NEXT_PUBLIC.*(?:BACKEND|NEST)|(?:BACKEND|NEST).*(?:URL|ORIGIN)/iu.test(
      name,
    )
  );
}

/** @param {Program} program */
function callsNestOperationByAbsoluteUrl(program) {
  /** @type {Map<string, string>} */
  const absoluteStringBindings = new Map();
  let found = false;
  new Visitor({
    VariableDeclarator(node) {
      const value = literalString(node.init);
      if (
        node.id.type === "Identifier" &&
        value !== undefined &&
        /^https?:\/\//u.test(value)
      ) {
        absoluteStringBindings.set(node.id.name, value);
      }
    },
    CallExpression(node) {
      const argument = node.arguments[0];
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "fetch" &&
        argument !== undefined &&
        argument.type !== "SpreadElement" &&
        isNestOperationUrl(
          resolveAbsoluteFetchArgument(argument, absoluteStringBindings),
        )
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function callsSameOriginMutationDynamically(program) {
  /** @type {Set<string>} */
  const directBindings = new Set();
  /** @type {Set<string>} */
  const namespaceBindings = new Set();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== "@/shared/api/same-origin-mutation"
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        exportedName(specifier.imported) === "requestSameOriginMutation"
      ) {
        directBindings.add(specifier.local.name);
      }
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaceBindings.add(specifier.local.name);
      }
    }
  }

  let found = false;
  new Visitor({
    CallExpression(node) {
      const callsDirectBinding =
        node.callee.type === "Identifier" &&
        directBindings.has(node.callee.name);
      const callsNamespaceBinding =
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        namespaceBindings.has(node.callee.object.name) &&
        memberPropertyName(node.callee) === "requestSameOriginMutation";
      if (!callsDirectBinding && !callsNamespaceBinding) return;
      const route = node.arguments[0];
      const method = node.arguments[1];
      if (
        route === undefined ||
        route.type === "SpreadElement" ||
        method === undefined ||
        method.type === "SpreadElement" ||
        literalString(route) === undefined ||
        literalString(method) === undefined
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * Local names bound to `names` by import declarations whose source passes `fromSource`.
 *
 * @param {Program} program
 * @param {(source: string) => boolean} fromSource
 * @param {ReadonlySet<string>} names
 */
function importedBindings(program, fromSource, names) {
  /** @type {Set<string>} */
  const bindings = new Set();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      typeof statement.source.value !== "string" ||
      !fromSource(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        names.has(exportedName(specifier.imported))
      ) {
        bindings.add(specifier.local.name);
      }
    }
  }
  return bindings;
}

/**
 * Operations declared through `defineMutationOperation`, with their literal route and method.
 * A declaration whose path or method is not a literal returns `undefined` for that part.
 *
 * @param {Program} program
 */
function declaredMutationOperations(program) {
  const bindings = importedBindings(
    program,
    (source) => source === "@/shared/api/mutation-operation",
    new Set(["defineMutationOperation"]),
  );
  /** @type {{ path: string | undefined, method: string | undefined }[]} */
  const operations = [];
  new Visitor({
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || !bindings.has(node.callee.name))
        return;
      const definition = node.arguments[0];
      /** @param {string} name */
      const literalProperty = (name) => {
        if (definition?.type !== "ObjectExpression") return undefined;
        const property = definition.properties.find(
          (entry) =>
            entry.type === "Property" &&
            !entry.computed &&
            entry.key.type === "Identifier" &&
            entry.key.name === name,
        );
        return property?.type === "Property"
          ? literalString(property.value)
          : undefined;
      };
      operations.push({
        method: literalProperty("method"),
        path: literalProperty("path"),
      });
    },
  }).visit(program);
  return operations;
}

/**
 * Whether a Route Handler module exports `method`, declared there or re-exported.
 *
 * @param {Program} program
 * @param {string} method
 */
function exportsRouteMethod(program, method) {
  return program.body.some((statement) => {
    if (statement.type !== "ExportNamedDeclaration") return false;
    const declaration = statement.declaration;
    if (declaration?.type === "FunctionDeclaration") {
      return declaration.id?.name === method;
    }
    if (declaration?.type === "VariableDeclaration") {
      return declaration.declarations.some(
        (entry) => entry.id.type === "Identifier" && entry.id.name === method,
      );
    }
    return statement.specifiers.some(
      (specifier) => exportedName(specifier.exported) === method,
    );
  });
}

/**
 * Calls of the form-encoded mutation helpers that ADR 0038 replaces with an operation. A streaming
 * upload passes its options as the third argument and stays outside this rule.
 *
 * @param {Program} program
 */
function usesFormMutationHelper(program) {
  const browserBindings = importedBindings(
    program,
    (source) => source === "@/shared/api/same-origin-mutation",
    new Set(["requestSameOriginMutation"]),
  );
  const namespaceImport = program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      statement.source.value === "@/shared/api/same-origin-mutation" &&
      statement.specifiers.some(
        (specifier) => specifier.type === "ImportNamespaceSpecifier",
      ),
  );
  const serverBindings = importedBindings(
    program,
    (source) => source.startsWith("@/shared/auth"),
    new Set(["handleAuthenticatedMutation"]),
  );
  const optionalBindings = importedBindings(
    program,
    (source) => source.startsWith("@/shared/auth"),
    new Set(["handleOptionalAuthenticatedMutation"]),
  );
  let found = namespaceImport;
  new Visitor({
    CallExpression(node) {
      if (node.callee.type !== "Identifier") return;
      const name = node.callee.name;
      if (
        browserBindings.has(name) ||
        optionalBindings.has(name) ||
        (serverBindings.has(name) && node.arguments.length < 3)
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * A `fetch` whose init names a method other than GET or HEAD: a browser write outside the
 * operation adapter.
 *
 * @param {Program} program
 */
function fetchesWithWriteMethod(program) {
  let found = false;
  new Visitor({
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "fetch")
        return;
      const init = node.arguments[1];
      if (init?.type !== "ObjectExpression") return;
      for (const property of init.properties) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.key.type !== "Identifier" ||
          property.key.name !== "method"
        ) {
          continue;
        }
        const method = literalString(property.value)?.toUpperCase();
        if (method !== "GET" && method !== "HEAD") found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * @param {import("oxc-parser").Expression} argument
 * @param {Map<string, string>} absoluteStringBindings
 */
function resolveAbsoluteFetchArgument(argument, absoluteStringBindings) {
  const literal = literalString(argument);
  if (literal !== undefined && /^https?:\/\//u.test(literal)) {
    return literal;
  }
  if (argument.type === "Identifier") {
    return absoluteStringBindings.get(argument.name);
  }
  if (argument.type !== "TemplateLiteral") return undefined;

  let value =
    argument.quasis[0]?.value.cooked ?? argument.quasis[0]?.value.raw ?? "";
  for (const [index, expression] of argument.expressions.entries()) {
    if (expression.type !== "Identifier") return undefined;
    const binding = absoluteStringBindings.get(expression.name);
    if (binding === undefined) return undefined;
    const quasi = argument.quasis[index + 1];
    value += binding + (quasi?.value.cooked ?? quasi?.value.raw ?? "");
  }
  return /^https?:\/\//u.test(value) ? value : undefined;
}

/** @param {AstNode | null | undefined} node */
function literalString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  }
  return undefined;
}

/** @param {AstNode | null | undefined} node */
function memberPropertyName(node) {
  if (node?.type !== "MemberExpression") return "";
  if (node.property.type === "Identifier") return node.property.name;
  return node.property.type === "Literal" &&
    typeof node.property.value === "string"
    ? node.property.value
    : "";
}

/**
 * The name an import or export specifier names, written as an identifier or a string.
 *
 * @param {import("oxc-parser").ModuleExportName} node
 */
function exportedName(node) {
  return "name" in node ? node.name : node.value;
}

/** @param {string | undefined} value */
function isNestOperationUrl(value) {
  if (value === undefined) return false;
  try {
    const pathname = new URL(value).pathname;
    return backendOperationPathPatterns.some((pattern) =>
      pattern.test(pathname),
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} importer
 * @param {string} specifier
 * @param {ReadonlyMap<string, unknown>} knownFiles
 */
function resolveLocalModule(importer, specifier, knownFiles) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.resolve(webRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return undefined;
  }

  for (const candidate of [
    base,
    ...[".ts", ".tsx", ".mts", ".cts"].map(
      (extension) => `${base}${extension}`,
    ),
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return undefined;
}

for (const scanRoot of scanRoots) {
  if (!existsSync(scanRoot)) {
    throw new TypeError(`Architecture scan root does not exist: ${scanRoot}`);
  }
}

const parsedFiles = new Map(
  [...new Set(scanRoots.flatMap(sourceFiles))].map((file) => {
    const { errors, program } = parseSync(file, readFileSync(file, "utf8"));
    const [firstError] = errors;
    if (firstError !== undefined) {
      throw new SyntaxError(
        `Oxc could not parse ${file}: ${firstError.message}`,
      );
    }
    return /** @type {const} */ ([file, program]);
  }),
);
/**
 * Модули, до которых браузерная граница дотягивается по рёбрам `edges`.
 *
 * @param {(program: Program) => string[]} edges
 */
function browserReachable(edges) {
  const reached = new Set(
    [...parsedFiles].flatMap(([file, program]) =>
      /\.client\.[cm]?[jt]sx?$/.test(file) || hasUseClientDirective(program)
        ? [file]
        : [],
    ),
  );
  const pending = [...reached];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined) break;
    const program = parsedFiles.get(file);
    if (program === undefined) continue;
    for (const specifier of edges(program)) {
      const dependency = resolveLocalModule(file, specifier, parsedFiles);
      if (dependency !== undefined && !reached.has(dependency)) {
        reached.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return reached;
}

const browserFiles = browserReachable(moduleSpecifiers);
/** Модули, которые попадают в браузерную сборку: без рёбер `import type`. */
const browserBundleFiles = browserReachable(valueModuleSpecifiers);

const findings = [...parsedFiles].flatMap(([file, program]) => {
  const sourcePath = scannedPath(file);
  const insideBackendTransport = sourcePath.startsWith(
    "src/shared/api/backend/",
  );
  const insideRuntimeConfiguration =
    sourcePath === "src/shared/config/runtime-config.server.ts";
  const insideApplicationRouting =
    sourcePath.startsWith("src/shared/routing/") ||
    sourcePath.startsWith("src/widgets/authoring-shell/");
  const ownsPublicSiteOrigin =
    sourcePath.startsWith("src/shared/link-preview/") ||
    sourcePath.startsWith("src/shared/auth/");
  const isBrowserCode = browserFiles.has(file);
  const specifiers = moduleSpecifiers(program);
  const findingsForFile = specifiers.flatMap((specifier) => {
    const dependency = resolveLocalModule(file, specifier, parsedFiles);
    const boundaryFinding =
      dependency === undefined ? undefined : layerFinding(file, dependency);
    if (boundaryFinding !== undefined) return [boundaryFinding];
    if (documentBlockKitSpecifiers.has(specifier)) {
      return [
        `${sourcePath}: material document blocks belong to the shared block registry; import them from @inside/material-blocks`,
      ];
    }
    if (!insideBackendTransport && specifier === "openapi-typescript-codegen") {
      return [
        `${sourcePath}: codegen runtime belongs to the backend transport module`,
      ];
    }
    if (
      !insideBackendTransport &&
      specifier.includes("shared/api/backend/generated")
    ) {
      return [
        `${sourcePath}: generated API types belong to the backend transport module`,
      ];
    }
    if (
      isBrowserCode &&
      (specifier.includes("shared/api/backend/index.server") ||
        specifier.includes("shared/api/backend/generated"))
    ) {
      return [
        `${sourcePath}: browser code cannot import the direct Nest transport; use a same-origin BFF route`,
      ];
    }
    return [];
  });

  if (declaresDocumentNode(program)) {
    findingsForFile.push(
      `${sourcePath}: material document blocks belong to the shared block registry; add the block there instead of declaring a node here`,
    );
  }

  if (
    /(?:^|\/)app\/(?:.*\/)?route\.tsx?$/u.test(sourcePath) &&
    !prerenderedRouteHandlers.some((allowed) => sourcePath.endsWith(allowed))
  ) {
    const finding = getHandlerFinding(program);
    if (finding !== undefined) {
      findingsForFile.push(
        finding === "start"
          ? `${sourcePath}: a GET Route Handler starts with await connection(), or the build prerenders its answer`
          : `${sourcePath}: declare GET in the route file so that it starts with await connection()`,
      );
    }
  }

  const cached = cacheDirectives(program);
  if (cached.length > 0) {
    if (!sourcePath.endsWith(".public-cache.server.ts")) {
      findingsForFile.push(
        `${sourcePath}: "use cache" belongs to a *.public-cache.server.ts module that reads the catalog as a guest`,
      );
    }
    if (cached.some((directive) => directive !== "use cache")) {
      findingsForFile.push(
        `${sourcePath}: only the shared "use cache" is allowed; a per-session cache would carry protected content into prefetch`,
      );
    }
    // Директива на уровне модуля кеширует каждую его функцию и прячет их от проверки политики.
    if (program.body.some(isCacheDirective)) {
      findingsForFile.push(
        `${sourcePath}: declare "use cache" inside the function, not for the module, so that each cached read carries its own policy`,
      );
    }
    if (hasCachedReadWithoutPolicy(program)) {
      findingsForFile.push(
        `${sourcePath}: a cached catalog read sets its tag and lifetime through applyCatalogCachePolicy, or an authoring write cannot expire it`,
      );
    }
    if (seesTheSession(program)) {
      findingsForFile.push(
        `${sourcePath}: a cached catalog read cannot see the session; read it as a guest and keep the personal read uncached`,
      );
    }
  }

  if (
    moduleSpecifiers(program).includes("next/cache") &&
    namesIdentifier(program, "unstable_cache")
  ) {
    findingsForFile.push(
      `${sourcePath}: unstable_cache is a second shared cache outside the guest-read rule; use a *.public-cache.server.ts module`,
    );
  }

  if (hasDirective(program, "use server")) {
    findingsForFile.push(
      `${sourcePath}: Server Actions are not part of the client-owned mutation path; use TanStack Query and a same-origin Route Handler`,
    );
  }

  if (
    !insideBackendTransport &&
    !insideApplicationRouting &&
    stringLiterals(program).some((value) => backendOperationPaths.has(value))
  ) {
    findingsForFile.push(
      `${sourcePath}: manual Nest operation paths belong to the backend transport module`,
    );
  }
  if (isBrowserCode && readsBackendEndpointEnvironment(program)) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot address Nest directly; use a same-origin BFF route`,
    );
  }
  if (isBrowserCode && callsNestOperationByAbsoluteUrl(program)) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot call a Nest operation by absolute URL; use a same-origin BFF route`,
    );
  }
  const operations = declaredMutationOperations(program);
  if (operations.length > 0 && !/\.operation\.ts$/u.test(sourcePath)) {
    findingsForFile.push(
      `${sourcePath}: declare a mutation operation in its own *.operation.ts module`,
    );
  }
  for (const operation of operations) {
    if (
      operation.path === undefined ||
      operation.method === undefined ||
      !operation.path.startsWith("/api/")
    ) {
      findingsForFile.push(
        `${sourcePath}: a mutation operation declares a literal /api/ path and HTTP method`,
      );
      continue;
    }
    const routeSuffix = `app${operation.path}/route.ts`;
    const route = [...parsedFiles].find(([candidate]) =>
      scannedPath(candidate).endsWith(routeSuffix),
    );
    if (
      route === undefined ||
      !exportsRouteMethod(route[1], operation.method)
    ) {
      findingsForFile.push(
        `${sourcePath}: mutation operation ${operation.method} ${operation.path} needs ${routeSuffix} exporting ${operation.method}`,
      );
    }
  }
  if (
    usesFormMutationHelper(program) &&
    !formMutationModulesAwaitingOperations.has(sourcePath)
  ) {
    findingsForFile.push(
      `${sourcePath}: a new mutation declares its operation with defineMutationOperation and serves it with handleMutationOperation; FormData helpers remain only for mutations awaiting #1679`,
    );
  }
  if (
    (isBrowserCode || /\.browser\.tsx?$/u.test(sourcePath)) &&
    sourcePath !== "src/shared/api/mutation-operation.ts" &&
    sourcePath !== "src/shared/api/same-origin-mutation.ts" &&
    !directBrowserWriteModules.has(sourcePath) &&
    fetchesWithWriteMethod(program)
  ) {
    findingsForFile.push(
      `${sourcePath}: a browser write goes through its mutation operation's send; direct fetch writes are limited to binary uploads and delivery reports`,
    );
  }
  if (callsSameOriginMutationDynamically(program)) {
    findingsForFile.push(
      `${sourcePath}: each browser mutation must declare a literal same-origin route and HTTP method`,
    );
  }
  if (
    !ownsPublicSiteOrigin &&
    !insideRuntimeConfiguration &&
    readsPublicSiteOrigin(program)
  ) {
    findingsForFile.push(
      `${sourcePath}: the public site origin belongs to the link preview module; read it there so it stays a request-time value`,
    );
  }
  if (
    !insideRuntimeConfiguration &&
    readsRuntimeConfigurationEnvironment(program)
  ) {
    findingsForFile.push(
      `${sourcePath}: application runtime environment belongs to the server-only config module`,
    );
  }
  const insideApp = /(?:^|\/)app\//u.test(sourcePath);
  if (insideApp && namesGeneratedRouteType(program)) {
    findingsForFile.push(
      `${sourcePath}: a route declares its own params and searchParams types; generated PageProps and LayoutProps do not exist before next typegen`,
    );
  }
  if (assertsComputedRoute(program)) {
    findingsForFile.push(
      `${sourcePath}: build a Route from computed text with internalRoute; an assertion holds only before or after next typegen`,
    );
  }
  // Нарушение несёт импортирующий модуль; достигнутый им модуль `*.server` — не второе нарушение.
  if (
    browserBundleFiles.has(file) &&
    !isServerInterface(sourcePath) &&
    valueModuleSpecifiers(program).some(isServerInterface)
  ) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot import a server-only interface; it would ship server code and secrets to the browser`,
    );
  }
  if (!isStorybookModule(sourcePath) && specifiers.some(namesStorybookModule)) {
    findingsForFile.push(
      `${sourcePath}: Storybook proofs and fixtures stay outside the production graph, or the catalog ships with the application`,
    );
  }
  const staleTime = dynamicStaleTimeDeclaration(program);
  if (staleTime !== undefined) {
    if (
      !/(?:^|\/)app\/\(public\)\/(?:\(catalog\)\/(?:.*\/)?)?page\.tsx$/u.test(
        sourcePath,
      )
    ) {
      findingsForFile.push(
        `${sourcePath}: only a catalog page keeps itself in browser memory with unstable_dynamicStaleTime`,
      );
    } else if (staleTime === "computed") {
      findingsForFile.push(
        `${sourcePath}: declare unstable_dynamicStaleTime as a number literal in the route file`,
      );
    }
  }
  if (
    /(?:^|\/)app\/authoring\/(?:.*\/)?error\.tsx$/u.test(sourcePath) &&
    (declaresMain(program) ||
      !importsNamed(
        program,
        "@/_pages/route-states",
        "MaterialAuthoringRouteError",
      ))
  ) {
    findingsForFile.push(
      `${sourcePath}: an authoring error boundary uses MaterialAuthoringRouteError instead of declaring its own shell`,
    );
  }
  if (/(?:^|\/)app\/(?:.*\/)?(?:global-)?error\.tsx$/u.test(sourcePath)) {
    if (
      !importsNamed(
        program,
        "@/features/client-telemetry",
        "useRenderErrorReport",
      )
    ) {
      findingsForFile.push(
        `${sourcePath}: an error boundary reports the error through useRenderErrorReport, or the failure leaves no log line`,
      );
    }
    if (takesResetProp(program)) {
      findingsForFile.push(
        `${sourcePath}: an error boundary recovers with retry; reset re-renders the same failure without a request`,
      );
    }
  }
  if (
    !/(?:^|\/)src\/shared\/auth\//u.test(sourcePath) &&
    !/(?:^|\/)app\/(?:.*\/)?route\.tsx?$/u.test(sourcePath) &&
    specifiers.some((specifier) => specifier.startsWith("@logto/"))
  ) {
    findingsForFile.push(
      `${sourcePath}: a server render reads the session only through @/shared/auth, whose connection() stops a prefetch before it starts a token refresh`,
    );
  }
  if (
    sourcePath !== "src/shared/api/fact-announcement.ts" &&
    (namesIdentifier(program, "BroadcastChannel") ||
      stringLiterals(program).includes("BroadcastChannel"))
  ) {
    findingsForFile.push(
      `${sourcePath}: BroadcastChannel belongs to src/shared/api/fact-announcement.ts`,
    );
  }
  if (specifiers.some((specifier) => siteAnimationPackages.test(specifier))) {
    findingsForFile.push(
      `${sourcePath}: site animation is a CSS component beside its page; Remotion and framer-motion are not site assets`,
    );
  }
  return findingsForFile;
});

// Список ожидающих перевода только сокращается: переведённый или удалённый модуль уходит из него.
if (requestedRoots.length === 0) {
  for (const awaiting of formMutationModulesAwaitingOperations) {
    const program = parsedFiles.get(path.resolve(webRoot, awaiting));
    if (program === undefined || !usesFormMutationHelper(program)) {
      findings.push(
        `${awaiting}: no longer encodes a FormData mutation; remove it from formMutationModulesAwaitingOperations`,
      );
    }
  }
}

for (const entry of [...parsedFiles.keys()].filter((file) =>
  editorFreeRouteEntries.some((suffix) => scannedPath(file).endsWith(suffix)),
)) {
  for (const { file, program } of reachableModules(entry)) {
    for (const specifier of moduleSpecifiers(program)) {
      if (
        specifier.startsWith("@tiptap/") ||
        specifier === "@inside/material-blocks/schema"
      ) {
        findings.push(
          `${scannedPath(entry)}: reading and lightweight authoring routes cannot reach the Tiptap editor bundle (via ${scannedPath(file)})`,
        );
      }
    }
  }
}

for (const entry of [...parsedFiles.keys()].filter(
  (file) =>
    /^proxy\.[cm]?tsx?$/u.test(path.basename(file)) &&
    [webRoot, ...scanRoots]
      .map((root) => path.resolve(root))
      .includes(path.dirname(file)),
)) {
  for (const { file, program } of reachableModules(entry)) {
    if (
      moduleSpecifiers(program).some(reachesRequestTimeDependency) ||
      readsCookiesOrFetches(program, "inside.logout-return")
    ) {
      findings.push(
        `${scannedPath(entry)}: proxy decides without a backend request; it cannot reach the backend or the session (via ${scannedPath(file)})`,
      );
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Web transport architecture passed.\n");
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
