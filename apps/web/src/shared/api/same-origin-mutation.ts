export type SameOriginMutationResult =
  | { readonly body: unknown; readonly ok: true }
  | { readonly ok: false; readonly status: number };

/** Sends a browser mutation through its feature-owned same-origin BFF seam. */
export async function requestSameOriginMutation(
  url: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  formData: FormData,
): Promise<SameOriginMutationResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      body: formData,
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method,
    });
  } catch {
    return { ok: false, status: 503 };
  }

  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { body: await response.json(), ok: true };
  } catch {
    return { ok: false, status: 502 };
  }
}
