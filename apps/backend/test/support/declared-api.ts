import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { Ajv, type ValidateFunction } from "ajv";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { z } from "zod";
import addFormats from "ajv-formats";

/**
 * Ответ, прочитанный его собственным описанием.
 *
 * Владелец формы ответа один — сгенерированный документ OpenAPI: `pnpm api:check` держит его
 * равным контроллерам, поэтому проверке не нужна своя схема рядом. `toMatchObject` лишнего ключа
 * не видит, а каждый строгий читатель этого API на нём теряет всё тело, поэтому здесь форма
 * сверяется целиком, вместе с запретом необъявленных полей.
 */

const documentPath = new URL("../../openapi/platform-api.json", import.meta.url);
const schemaRootId = "inside://platform-api";

const mediaTypeSchema = z.object({ schema: z.unknown() }).loose();
const responseSchema = z.object({ content: z.record(z.string(), mediaTypeSchema).optional() }).loose();
const operationSchema = z.object({ responses: z.record(z.string(), responseSchema).optional() }).loose();
const documentSchema = z
  .object({
    paths: z.record(z.string(), z.record(z.string(), operationSchema)),
    components: z.object({ schemas: z.record(z.string(), z.unknown()).optional() }).loose().optional(),
  })
  .loose();

type OperationResponses = Record<string, z.infer<typeof responseSchema>>;

const document = readApiDocument();
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats.default(ajv);
// Документ владеет и именами форматов. Тот, который ajv оценить не умеет, остаётся непроверенным,
// а не рушит сверку целиком: собственный `pattern` рядом с таким форматом документ уже несёт.
for (const format of declaredFormats(document)) {
  if (ajv.formats[format] === undefined) ajv.addFormat(format, true);
}
ajv.addSchema({ $id: schemaRootId, definitions: translatedSchema(document.components?.schemas ?? {}) });

const validators = new Map<string, ValidateFunction>();

/** Ровно то, что сверка читает в ответе: статус и тело. */
export interface DeclaredResponseParts {
  readonly statusCode: number;
  json(): unknown;
}

/** Ровно то, что нужно сверке: сервер, которому можно отправить запрос. */
export interface InjectableServer<Response extends DeclaredResponseParts = LightMyRequestResponse> {
  inject(options: InjectOptions): Promise<Response>;
  ready(): PromiseLike<unknown>;
}

/** Fastify под контрактом: каждый ответ читается описанием, которое объявляет сам API. */
export function declaredServer<Response extends DeclaredResponseParts>(server: InjectableServer<Response>) {
  return {
    ready: () => server.ready(),
    inject: async (options: InjectOptions): Promise<Response> => {
      const response = await server.inject(options);
      const { method, url } = requestAddress(options);
      assertDeclaredResponse({ method, url, status: response.statusCode, body: () => response.json() });
      return response;
    },
  };
}

/**
 * Каждое объявленное JSON-тело — контракт, который сверка умеет выполнить. Перевод из OpenAPI
 * держится на `nullable` и булевых границах, поэтому смена генератора обязана падать здесь, а не
 * превращаться в тихо пропущенную проверку.
 */
export function compileDeclaredResponses(): number {
  let compiled = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      for (const [status, declared] of Object.entries(operation.responses ?? {})) {
        const schema = declared.content?.["application/json"]?.schema;
        if (schema === null || typeof schema !== "object") continue;
        compiledValidator(`${method.toUpperCase()} ${path} ${status}`, schema);
        compiled += 1;
      }
    }
  }
  return compiled;
}

/** Сверка одного уже полученного ответа: тело читается только когда описание его объявляет. */
export function assertDeclaredResponse(response: {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly body: () => unknown;
}): void {
  const operation = declaredOperation(response.method, response.url);
  const declared = operation[String(response.status)];
  if (declared === undefined) {
    if (response.status >= 200 && response.status < 300) {
      throw new Error(
        `${address(response)} answered ${String(response.status)}, which its OpenAPI operation does not declare.`,
      );
    }
    return;
  }
  const schema = declared.content?.["application/json"]?.schema;
  if (schema === null || typeof schema !== "object") return;
  const validate = compiledValidator(`${response.method} ${response.url} ${String(response.status)}`, schema);
  if (validate(response.body())) return;
  throw new Error(
    `${address(response)} answered ${String(response.status)} with a body its own description rejects:\n${
      (validate.errors ?? [])
        .map((error) => `  ${error.instancePath === "" ? "/" : error.instancePath} ${error.message ?? ""} ${JSON.stringify(error.params)}`)
        .join("\n")
    }`,
  );
}

function readApiDocument(): z.infer<typeof documentSchema> {
  const parsed = documentSchema.safeParse(JSON.parse(readFileSync(documentPath, "utf8")));
  if (!parsed.success) {
    throw new Error(`${documentPath.pathname} is not an OpenAPI document. Run \`pnpm api:generate\`.`);
  }
  return parsed.data;
}

function address(response: { readonly method: string; readonly url: string }): string {
  return `${response.method} ${response.url}`;
}

function compiledValidator(key: string, schema: object): ValidateFunction {
  const existing = validators.get(key);
  if (existing !== undefined) return existing;
  const validate = ajv.compile(translatedSchema(schema));
  validators.set(key, validate);
  return validate;
}

function requestAddress(options: InjectOptions): { method: string; url: string } {
  const target = options.url ?? options.path;
  const url = typeof target === "string" ? target : target?.pathname ?? "";
  return { method: (options.method ?? "GET").toUpperCase(), url };
}

/** Адрес приводится к объявленному шаблону: точное совпадение важнее параметризованного. */
function declaredOperation(method: string, url: string): OperationResponses {
  const path = url.split("?")[0] ?? url;
  const exact = document.paths[path]?.[method.toLowerCase()];
  if (exact !== undefined) return exact.responses ?? {};
  for (const [declaredPath, item] of Object.entries(document.paths)) {
    const operation = item[method.toLowerCase()];
    if (operation === undefined || !pathTemplate(declaredPath).test(path)) continue;
    return operation.responses ?? {};
  }
  throw new Error(`The API declares no ${method} ${path}; a test address the document does not know cannot be checked.`);
}

const templates = new Map<string, RegExp>();

function pathTemplate(declaredPath: string): RegExp {
  const existing = templates.get(declaredPath);
  if (existing !== undefined) return existing;
  const pattern = new RegExp(
    `^${declaredPath
      .split(/(\{[^}]+\})/u)
      .map((part) => (/^\{[^}]+\}$/u.test(part) ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
      .join("")}$`,
    "u",
  );
  templates.set(declaredPath, pattern);
  return pattern;
}

/**
 * OpenAPI 3.0 описывает форму почти как JSON Schema, но `nullable` и булев `exclusiveMinimum`
 * принадлежат только ему. Перевод их снимает, а ссылки на общие схемы уводит в корень.
 */
function translated(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(translated);
  if (value === null || typeof value !== "object") return value;
  return translatedSchema(value);
}

function translatedSchema(value: object): Record<string, unknown> {
  const source: Record<string, unknown> = { ...value };
  const bounds: Record<string, number> = {};
  const dropped = new Set(["nullable"]);
  if (source.exclusiveMinimum === true && typeof source.minimum === "number") {
    bounds.exclusiveMinimum = source.minimum;
    dropped.add("minimum").add("exclusiveMinimum");
  }
  if (source.exclusiveMaximum === true && typeof source.maximum === "number") {
    bounds.exclusiveMaximum = source.maximum;
    dropped.add("maximum").add("exclusiveMaximum");
  }
  const schema: Record<string, unknown> = {
    ...Object.fromEntries(
      Object.entries(source)
        .filter(([key]) => !dropped.has(key))
        .map(([key, entry]) => [
          key,
          key === "$ref" && typeof entry === "string" && entry.startsWith("#/components/schemas/")
            ? `${schemaRootId}#/definitions/${entry.slice("#/components/schemas/".length)}`
            : translated(entry),
        ]),
    ),
    ...bounds,
  };
  return source.nullable === true ? { anyOf: [schema, { type: "null" }] } : schema;
}

function declaredFormats(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) declaredFormats(entry, found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "format" && typeof entry === "string") found.add(entry);
    else declaredFormats(entry, found);
  }
  return found;
}
