import "server-only";

import { z } from "zod";

import {
  backendProxyProblem,
  requestCreateGuideArtifactFile,
  requestCreateGuideArtifactFromLink,
  requestGuideArtifactsForGuide,
  requestRemoveGuideArtifact,
  requestReplaceGuideArtifactFile,
  requestReplaceGuideArtifactLink,
  requestReusableGuideArtifacts,
  requestSetGuideArtifactArchived,
  requestSetGuideArtifactGuides,
  requestUpdateGuideArtifact,
  BackendConnectionError,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { MAX_GUIDE_ARTIFACT_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import {
  getOptionalPlatformAccessToken,
  handleAuthenticatedMutation,
  type AuthenticatedMutationFailure,
} from "@/shared/auth/index.server";
import {
  guideArtifactListSchema,
  guideArtifactSchema,
  type GuideArtifactListState,
  type GuideArtifactMutationResult,
} from "../model/guide-artifacts";

const uuidSchema = z.uuid();
const metadataFieldsSchema = z
  .object({
    access: z.enum(["free", "membership"]),
    purpose: z.string().max(1000),
    title: z.string().min(1).max(200),
  })
  .strict();
const externalUrlSchema = z.url({ protocol: /^https?$/u }).max(2048);
const guideIdsSchema = z.array(uuidSchema).max(50);
const referencedProblemSchema = z
  .object({ code: z.literal("artifact_referenced"), guideIds: guideIdsSchema })
  .loose();

const privateHeaders = { "cache-control": "private, no-store" } as const;

export async function handleReadGuideArtifactsRequest(
  guideId: string,
): Promise<Response> {
  return readArtifactList((token) => requestGuideArtifactsForGuide(guideId, token));
}

export async function handleReadReusableGuideArtifactsRequest(): Promise<Response> {
  return readArtifactList((token) => requestReusableGuideArtifacts(token));
}

export function handleCreateGuideArtifactFile(request: Request): Promise<Response> {
  return streamArtifactUpload(request, (body, contentType, accessToken) =>
    requestCreateGuideArtifactFile({
      accessToken,
      body,
      contentType,
      signal: request.signal,
    }),
  );
}

export function handleReplaceGuideArtifactFile(request: Request): Promise<Response> {
  return streamArtifactUpload(request, (body, contentType, accessToken) =>
    requestReplaceGuideArtifactFile({
      accessToken,
      body,
      contentType,
      signal: request.signal,
    }),
  );
}

export function handleCreateGuideArtifactLink(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const metadata = metadataFieldsSchema.safeParse(readMetadata(formData));
    const externalUrl = externalUrlSchema.safeParse(formData.get("externalUrl"));
    const guideId = uuidSchema.safeParse(formData.get("guideId"));
    if (!metadata.success || !externalUrl.success || !guideId.success) {
      return rejected("Проверьте название и адрес артефакта.");
    }
    return mutationResult(() =>
      requestCreateGuideArtifactFromLink(
        { ...metadata.data, externalUrl: externalUrl.data, guideId: guideId.data },
        accessToken,
      ),
    );
  });
}

export function handleUpdateGuideArtifact(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const metadata = metadataFieldsSchema.safeParse(readMetadata(formData));
    const artifactId = uuidSchema.safeParse(formData.get("artifactId"));
    if (!metadata.success || !artifactId.success) {
      return rejected("Проверьте название артефакта.");
    }
    return mutationResult(() =>
      requestUpdateGuideArtifact(
        { ...metadata.data, artifactId: artifactId.data },
        accessToken,
      ),
    );
  });
}

export function handleReplaceGuideArtifactLink(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const artifactId = uuidSchema.safeParse(formData.get("artifactId"));
    const externalUrl = externalUrlSchema.safeParse(formData.get("externalUrl"));
    if (!artifactId.success || !externalUrl.success) {
      return rejected("Укажите адрес, начинающийся с http или https.");
    }
    return mutationResult(() =>
      requestReplaceGuideArtifactLink(
        { artifactId: artifactId.data, externalUrl: externalUrl.data },
        accessToken,
      ),
    );
  });
}

export function handleSetGuideArtifactArchived(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const artifactId = uuidSchema.safeParse(formData.get("artifactId"));
    const archived = formData.get("archived");
    if (!artifactId.success || (archived !== "true" && archived !== "false")) {
      return rejected("Не удалось изменить состояние артефакта.");
    }
    return mutationResult(() =>
      requestSetGuideArtifactArchived(
        { archived: archived === "true", artifactId: artifactId.data },
        accessToken,
      ),
    );
  });
}

export function handleSetGuideArtifactGuides(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const artifactId = uuidSchema.safeParse(formData.get("artifactId"));
    const guideIds = parseGuideIds(formData.get("guideIds"));
    if (!artifactId.success || guideIds === null) {
      return rejected("Не удалось изменить размещение артефакта.");
    }
    return mutationResult(() =>
      requestSetGuideArtifactGuides(
        { artifactId: artifactId.data, guideIds },
        accessToken,
      ),
    );
  });
}

export function handleRemoveGuideArtifact(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const artifactId = uuidSchema.safeParse(formData.get("artifactId"));
    if (!artifactId.success) return rejected("Артефакт не найден.");
    let result: BackendTransportResult;
    try {
      result = await requestRemoveGuideArtifact(artifactId.data, accessToken);
    } catch (error) {
      return transportFailure(error);
    }
    if (result.ok) {
      return { artifactId: artifactId.data, kind: "removed" } as const;
    }
    return failureResult(result);
  });
}

async function readArtifactList(
  request: (accessToken: string) => Promise<BackendTransportResult>,
): Promise<Response> {
  let token: string | undefined;
  try {
    token = await getOptionalPlatformAccessToken();
  } catch {
    return listResponse({ kind: "error", reference: "guide-artifacts-session" });
  }
  if (token === undefined) return listResponse({ kind: "unauthorized" });
  let result: BackendTransportResult;
  try {
    result = await request(token);
  } catch (error) {
    return listResponse({
      kind: "error",
      reference:
        error instanceof BackendConnectionError
          ? error.code
          : "guide-artifacts-transport",
    });
  }
  if (!result.ok) {
    const status = result.response.status;
    if (status === 401 || status === 403) return listResponse({ kind: "unauthorized" });
    if (status === 404) return listResponse({ kind: "not_found" });
    return listResponse({ kind: "error", reference: "guide-artifacts-response" });
  }
  const parsed = guideArtifactListSchema.safeParse(result.body);
  return listResponse(
    parsed.success
      ? { artifacts: parsed.data.artifacts, kind: "ready" }
      : { kind: "error", reference: "guide-artifacts-shape" },
  );
}

function listResponse(state: GuideArtifactListState): Response {
  return Response.json(state, { headers: privateHeaders });
}

function streamArtifactUpload(
  request: Request,
  send: (
    body: ReadableStream<Uint8Array>,
    contentType: string,
    accessToken: string,
  ) => Promise<Response>,
): Promise<Response> {
  return handleAuthenticatedMutation(
    request,
    async (body, accessToken) => {
      const contentType = request.headers.get("content-type");
      if (
        body === null ||
        contentType?.toLowerCase().startsWith("multipart/form-data;") !== true
      ) {
        return backendProxyProblem(
          400,
          "invalid_artifact",
          "Guide Artifact form is malformed",
        );
      }
      // The browser owns one artifact mutation contract, so a streamed upload
      // returns the same typed result as every buffered mutation.
      return normalizedUploadResponse(await send(body, contentType, accessToken));
    },
    {
      failureResponse: uploadFailure,
      maxBytes: MAX_GUIDE_ARTIFACT_MUTATION_BYTES,
      mode: "stream",
    },
  );
}

async function normalizedUploadResponse(backend: Response): Promise<Response> {
  let body: unknown;
  try {
    body = await backend.json();
  } catch {
    return Response.json(
      { kind: "error", reference: "guide-artifacts-shape" } satisfies GuideArtifactMutationResult,
      { headers: privateHeaders },
    );
  }
  if (backend.ok) {
    const parsed = guideArtifactSchema.safeParse(body);
    return Response.json(
      parsed.success
        ? ({ artifact: parsed.data, kind: "saved" } satisfies GuideArtifactMutationResult)
        : ({ kind: "error", reference: "guide-artifacts-shape" } satisfies GuideArtifactMutationResult),
      { headers: privateHeaders },
    );
  }
  return Response.json(
    failureResult({ ok: false, problem: body, response: backend }),
    { headers: privateHeaders },
  );
}

function uploadFailure(failure: AuthenticatedMutationFailure): Response {
  switch (failure) {
    case "authentication_required":
      return backendProxyProblem(401, failure, "Authentication required");
    case "body_too_large":
      return backendProxyProblem(
        413,
        "invalid_content",
        "Guide Artifact exceeds the size limit",
      );
    case "cross_origin_request":
      return backendProxyProblem(
        403,
        failure,
        "Cross-origin Guide Artifact mutation is forbidden",
      );
    case "dependency_unavailable":
      return backendProxyProblem(
        503,
        failure,
        "Guide Artifact mutation is unavailable",
      );
    case "identity_unavailable":
      return backendProxyProblem(503, failure, "Identity session is unavailable");
  }
}

async function mutationResult(
  request: () => Promise<BackendTransportResult>,
): Promise<GuideArtifactMutationResult> {
  let result: BackendTransportResult;
  try {
    result = await request();
  } catch (error) {
    return transportFailure(error);
  }
  if (!result.ok) return failureResult(result);
  const parsed = guideArtifactSchema.safeParse(result.body);
  return parsed.success
    ? { artifact: parsed.data, kind: "saved" }
    : { kind: "error", reference: "guide-artifacts-shape" };
}

function failureResult(
  result: Extract<BackendTransportResult, { ok: false }>,
): GuideArtifactMutationResult {
  const status = result.response.status;
  if (status === 401 || status === 403) return { kind: "unauthorized" };
  if (status === 409) {
    const referenced = referencedProblemSchema.safeParse(result.problem);
    if (referenced.success) {
      return { guideIds: referenced.data.guideIds, kind: "referenced" };
    }
  }
  if (status === 404) {
    return { kind: "rejected", reason: "Артефакт или руководство не найдены." };
  }
  if (status === 413) {
    return { kind: "rejected", reason: "Файл больше допустимого размера." };
  }
  if (status === 422) {
    return {
      kind: "rejected",
      reason: "Такой файл нельзя приложить: он выглядит как программа или скрипт.",
    };
  }
  return { kind: "error", reference: `guide-artifacts-${String(status)}` };
}

function transportFailure(error: unknown): GuideArtifactMutationResult {
  return {
    kind: "error",
    reference:
      error instanceof BackendConnectionError
        ? error.code
        : "guide-artifacts-transport",
  };
}

function rejected(reason: string): GuideArtifactMutationResult {
  return { kind: "rejected", reason };
}

function readMetadata(formData: FormData) {
  return {
    access: formData.get("access"),
    purpose: formData.get("purpose") ?? "",
    title: formData.get("title"),
  };
}

function parseGuideIds(value: FormDataEntryValue | null): string[] | null {
  if (typeof value !== "string") return null;
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    return null;
  }
  const parsed = guideIdsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
