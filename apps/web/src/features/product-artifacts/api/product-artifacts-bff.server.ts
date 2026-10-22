import "server-only";

import { z } from "zod";

import {
  backendProxyProblem,
  requestCreateProductArtifactFile,
  requestCreateProductArtifactFromLink,
  requestProductArtifactsForProduct,
  requestRemoveProductArtifact,
  requestReplaceProductArtifactFile,
  requestReplaceProductArtifactLink,
  requestReusableProductArtifacts,
  requestSetProductArtifactArchived,
  requestSetProductArtifactProducts,
  requestUpdateProductArtifact,
  BackendConnectionError,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { MAX_PRODUCT_ARTIFACT_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import {
  getOptionalPlatformAccessToken,
  handleAuthenticatedMutation,
  handleMutationOperation,
  type AuthenticatedMutationFailure,
} from "@/shared/auth/index.server";
import {
  ARTIFACT_NOT_ACCEPTED,
  ARTIFACT_TOO_LARGE,
  productArtifactListSchema,
  productArtifactSchema,
  type ProductArtifactListState,
  type ProductArtifactMutationResult,
} from "../model/product-artifacts";
import {
  createProductArtifactFromLinkOperation,
  productArtifactProductIdsSchema,
  removeProductArtifactOperation,
  replaceProductArtifactLinkOperation,
  setProductArtifactArchivedOperation,
  setProductArtifactProductsOperation,
  updateProductArtifactOperation,
} from "./product-artifacts.operation";

const referencedProblemSchema = z
  .object({
    code: z.literal("artifact_referenced"),
    productIds: productArtifactProductIdsSchema,
  })
  .loose();

const privateHeaders = { "cache-control": "private, no-store" } as const;

export async function handleReadProductArtifactsRequest(
  productId: string,
): Promise<Response> {
  return readArtifactList((token) =>
    requestProductArtifactsForProduct(productId, token),
  );
}

export async function handleReadReusableProductArtifactsRequest(): Promise<Response> {
  return readArtifactList((token) => requestReusableProductArtifacts(token));
}

export function handleCreateProductArtifactFile(
  request: Request,
): Promise<Response> {
  return streamArtifactUpload(request, (body, contentType, accessToken) =>
    requestCreateProductArtifactFile({
      accessToken,
      body,
      contentType,
      signal: request.signal,
    }),
  );
}

export function handleReplaceProductArtifactFile(
  request: Request,
): Promise<Response> {
  return streamArtifactUpload(request, (body, contentType, accessToken) =>
    requestReplaceProductArtifactFile({
      accessToken,
      body,
      contentType,
      signal: request.signal,
    }),
  );
}

export function handleCreateProductArtifactLink(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(
    request,
    createProductArtifactFromLinkOperation,
    {
      invalidInput: () => rejected("Проверьте название и адрес артефакта."),
      execute: (link, accessToken) =>
        mutationResult(() =>
          requestCreateProductArtifactFromLink(
            {
              access: link.access,
              purpose: link.purpose,
              title: link.title,
              externalUrl: link.externalUrl,
              productId: link.productId,
            },
            accessToken,
          ),
        ),
    },
  );
}

export function handleUpdateProductArtifact(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, updateProductArtifactOperation, {
    invalidInput: () => rejected("Проверьте название артефакта."),
    execute: (update, accessToken) =>
      mutationResult(() =>
        requestUpdateProductArtifact(
          {
            access: update.access,
            purpose: update.purpose,
            title: update.title,
            artifactId: update.artifactId,
          },
          accessToken,
        ),
      ),
  });
}

export function handleReplaceProductArtifactLink(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, replaceProductArtifactLinkOperation, {
    invalidInput: () =>
      rejected("Укажите адрес, начинающийся с http или https."),
    execute: ({ artifactId, externalUrl }, accessToken) =>
      mutationResult(() =>
        requestReplaceProductArtifactLink(
          { artifactId, externalUrl },
          accessToken,
        ),
      ),
  });
}

export function handleSetProductArtifactArchived(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, setProductArtifactArchivedOperation, {
    invalidInput: () => rejected("Не удалось изменить состояние артефакта."),
    execute: ({ archived, artifactId }, accessToken) =>
      mutationResult(() =>
        requestSetProductArtifactArchived(
          { archived, artifactId },
          accessToken,
        ),
      ),
  });
}

export function handleSetProductArtifactProducts(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, setProductArtifactProductsOperation, {
    invalidInput: () => rejected("Не удалось изменить размещение артефакта."),
    execute: ({ artifactId, productIds }, accessToken) =>
      mutationResult(() =>
        requestSetProductArtifactProducts(
          { artifactId, productIds },
          accessToken,
        ),
      ),
  });
}

export function handleRemoveProductArtifact(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, removeProductArtifactOperation, {
    invalidInput: () => rejected("Артефакт не найден."),
    execute: async ({ artifactId }, accessToken) => {
      let result: BackendTransportResult;
      try {
        result = await requestRemoveProductArtifact(artifactId, accessToken);
      } catch (error) {
        return transportFailure(error);
      }
      if (result.ok) {
        return { artifactId, kind: "removed" } as const;
      }
      return failureResult(result);
    },
  });
}

async function readArtifactList(
  request: (accessToken: string) => Promise<BackendTransportResult>,
): Promise<Response> {
  let token: string | undefined;
  try {
    token = await getOptionalPlatformAccessToken();
  } catch {
    return listResponse({
      kind: "error",
      reference: "product-artifacts-session",
    });
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
          : "product-artifacts-transport",
    });
  }
  if (!result.ok) {
    const status = result.response.status;
    if (status === 401 || status === 403)
      return listResponse({ kind: "unauthorized" });
    if (status === 404) return listResponse({ kind: "not_found" });
    return listResponse({
      kind: "error",
      reference: "product-artifacts-response",
    });
  }
  const parsed = productArtifactListSchema.safeParse(result.body);
  return listResponse(
    parsed.success
      ? { artifacts: parsed.data.artifacts, kind: "ready" }
      : { kind: "error", reference: "product-artifacts-shape" },
  );
}

function listResponse(state: ProductArtifactListState): Response {
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
          "Product Artifact form is malformed",
        );
      }
      // The browser owns one artifact mutation contract, so a streamed upload
      // returns the same typed result as every buffered mutation.
      return normalizedUploadResponse(
        await send(body, contentType, accessToken),
      );
    },
    {
      failureResponse: uploadFailure,
      maxBytes: MAX_PRODUCT_ARTIFACT_MUTATION_BYTES,
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
      {
        kind: "error",
        reference: "product-artifacts-shape",
      } satisfies ProductArtifactMutationResult,
      { headers: privateHeaders },
    );
  }
  if (backend.ok) {
    const parsed = productArtifactSchema.safeParse(body);
    return Response.json(
      parsed.success
        ? ({
            artifact: parsed.data,
            kind: "saved",
          } satisfies ProductArtifactMutationResult)
        : ({
            kind: "error",
            reference: "product-artifacts-shape",
          } satisfies ProductArtifactMutationResult),
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
        "Product Artifact exceeds the size limit",
      );
    case "cross_origin_request":
      return backendProxyProblem(
        403,
        failure,
        "Cross-origin Product Artifact mutation is forbidden",
      );
    case "dependency_unavailable":
      return backendProxyProblem(
        503,
        failure,
        "Product Artifact mutation is unavailable",
      );
    case "identity_unavailable":
      return backendProxyProblem(
        503,
        failure,
        "Identity session is unavailable",
      );
  }
}

async function mutationResult(
  request: () => Promise<BackendTransportResult>,
): Promise<ProductArtifactMutationResult> {
  let result: BackendTransportResult;
  try {
    result = await request();
  } catch (error) {
    return transportFailure(error);
  }
  if (!result.ok) return failureResult(result);
  const parsed = productArtifactSchema.safeParse(result.body);
  return parsed.success
    ? { artifact: parsed.data, kind: "saved" }
    : { kind: "error", reference: "product-artifacts-shape" };
}

function failureResult(
  result: Extract<BackendTransportResult, { ok: false }>,
): ProductArtifactMutationResult {
  const status = result.response.status;
  if (status === 401 || status === 403) return { kind: "unauthorized" };
  if (status === 409) {
    const referenced = referencedProblemSchema.safeParse(result.problem);
    if (referenced.success) {
      return { productIds: referenced.data.productIds, kind: "referenced" };
    }
  }
  if (status === 404) {
    return { kind: "rejected", reason: "Артефакт или продукт не найдены." };
  }
  if (status === 413) return { kind: "rejected", reason: ARTIFACT_TOO_LARGE };
  if (status === 422) {
    return { kind: "rejected", reason: ARTIFACT_NOT_ACCEPTED };
  }
  return { kind: "error", reference: `product-artifacts-${String(status)}` };
}

function transportFailure(error: unknown): ProductArtifactMutationResult {
  return {
    kind: "error",
    reference:
      error instanceof BackendConnectionError
        ? error.code
        : "product-artifacts-transport",
  };
}

function rejected(reason: string): ProductArtifactMutationResult {
  return { kind: "rejected", reason };
}
