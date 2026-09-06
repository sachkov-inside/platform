import "server-only";

/** Complete a same-origin form before navigating to Logto: CSP form-action also checks HTTP redirects. */
export function authNavigationResponse(
  url: string,
  headers: Record<string, string> = {},
): Response {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error("Invalid authentication destination");
  }
  const escaped = target.href.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
  return new Response(
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${escaped}"><title>Переходим…</title><p><a href="${escaped}">Продолжить</a></p></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
        "referrer-policy": "no-referrer",
        ...headers,
      },
    },
  );
}
