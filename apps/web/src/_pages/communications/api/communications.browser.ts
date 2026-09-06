import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  commandSchema,
  deliveryListSchema,
  funnelListSchema,
  funnelSchema,
  introSchema,
  lifecycleSchema,
  previewSchema,
  resolveDeliverySchema,
  saveIntroSchema,
  saveSchema,
  templateReferenceSchema,
  templateSchema,
  resultSchema,
  type Result,
} from "../model/communications";

const listFunnelsInputSchema = z.object({ cursor: z.string().optional() });

const listFunnelsOutputSchema = funnelListSchema;

export async function listFunnels(
  input: z.infer<typeof listFunnelsInputSchema>,
): Promise<Result<z.infer<typeof listFunnelsOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/funnels/list",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(listFunnelsOutputSchema).safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const readFunnelInputSchema = z.object({ funnelId: z.guid() });

const readFunnelOutputSchema = funnelSchema;

export async function readFunnel(
  input: z.infer<typeof readFunnelInputSchema>,
): Promise<Result<z.infer<typeof readFunnelOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/funnels/read",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(readFunnelOutputSchema).safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const saveFunnelInputSchema = saveSchema;

const saveFunnelOutputSchema = funnelSchema;

export async function saveFunnel(
  input: z.infer<typeof saveFunnelInputSchema>,
): Promise<Result<z.infer<typeof saveFunnelOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/funnels/save",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(saveFunnelOutputSchema).safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const previewFunnelInputSchema = commandSchema;

const previewFunnelOutputSchema = previewSchema;

export async function previewFunnel(
  input: z.infer<typeof previewFunnelInputSchema>,
): Promise<Result<z.infer<typeof previewFunnelOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/funnels/preview",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(previewFunnelOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const publishFunnelInputSchema = commandSchema;

const publishFunnelOutputSchema = funnelSchema;

export async function publishFunnel(
  input: z.infer<typeof publishFunnelInputSchema>,
): Promise<Result<z.infer<typeof publishFunnelOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/funnels/publish",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(publishFunnelOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const changeFunnelLifecycleInputSchema = lifecycleSchema;

const changeFunnelLifecycleOutputSchema = funnelSchema;

export async function changeFunnelLifecycle(
  input: z.infer<typeof changeFunnelLifecycleInputSchema>,
): Promise<Result<z.infer<typeof changeFunnelLifecycleOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/funnels/lifecycle",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(changeFunnelLifecycleOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const readIntroInputSchema = z.object({});

const readIntroOutputSchema = introSchema;

export async function readIntro(
  input: z.infer<typeof readIntroInputSchema>,
): Promise<Result<z.infer<typeof readIntroOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/intro/read",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(readIntroOutputSchema).safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const saveIntroInputSchema = saveIntroSchema;

const saveIntroOutputSchema = introSchema;

export async function saveIntro(
  input: z.infer<typeof saveIntroInputSchema>,
): Promise<Result<z.infer<typeof saveIntroOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/intro/save",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(saveIntroOutputSchema).safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const readDeliveriesInputSchema = z.object({
  funnelId: z.guid(),
  cursor: z.string().optional(),
});

const readDeliveriesOutputSchema = deliveryListSchema;

export async function readDeliveries(
  input: z.infer<typeof readDeliveriesInputSchema>,
): Promise<Result<z.infer<typeof readDeliveriesOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/deliveries/read",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(readDeliveriesOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const skipDeliveryInputSchema = resolveDeliverySchema;

const skipDeliveryOutputSchema = z.object({
  deliveryId: z.guid(),
  partId: z.guid(),
  outcome: z.literal("skipped"),
});

export async function skipDelivery(
  input: z.infer<typeof skipDeliveryInputSchema>,
): Promise<Result<z.infer<typeof skipDeliveryOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/deliveries/skip",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(skipDeliveryOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const retryDeliveryInputSchema = resolveDeliverySchema;

const retryDeliveryOutputSchema = z.object({
  deliveryId: z.guid(),
  partId: z.guid(),
  outcome: z.literal("retry_requested"),
});

export async function retryDelivery(
  input: z.infer<typeof retryDeliveryInputSchema>,
): Promise<Result<z.infer<typeof retryDeliveryOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/deliveries/retry",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(retryDeliveryOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}

const resolveTemplateInputSchema = templateReferenceSchema;

const resolveTemplateOutputSchema = templateSchema;

export async function resolveTemplate(
  input: z.infer<typeof resolveTemplateInputSchema>,
): Promise<Result<z.infer<typeof resolveTemplateOutputSchema>>> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/communications/templates/resolve",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      kind: "error",
      code:
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
    };
  const parsed = resultSchema(resolveTemplateOutputSchema).safeParse(
    response.body,
  );
  return parsed.success ? parsed.data : { kind: "error", code: "unavailable" };
}
