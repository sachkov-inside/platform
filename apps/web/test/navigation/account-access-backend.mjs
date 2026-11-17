// @ts-check

const accounts = new Map([
  [
    "Bearer account-access-lifetimes-first",
    "62000000-0000-4000-8000-000000000011",
  ],
  [
    "Bearer account-access-lifetimes-second",
    "62000000-0000-4000-8000-000000000012",
  ],
]);
const attemptId = "62000000-0000-4000-8000-000000000021";
const product = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Проверочный продукт",
  slug: "navigation-proof",
};
const expiresAt = "2099-01-01T00:00:00.000Z";
const deepLink = "https://t.me/inside_test_bot?start=account_lifetime";

/** @returns {{ entered: PromiseWithResolvers<void>, release: PromiseWithResolvers<void> }} */
function hold() {
  return {
    entered: Promise.withResolvers(),
    release: Promise.withResolvers(),
  };
}

const state = () => ({
  begun: new Set(),
  linked: new Set(),
  confirms: /** @type {{linkRef: string, account: string}[]} */ ([]),
  activation: "pending",
  activationReads: 0,
  begin: /** @type {ReturnType<typeof hold> | null} */ (null),
  confirm: /** @type {ReturnType<typeof hold> | null} */ (null),
  confirmation: "pending",
});
let fixture = state();

/** @param {import("node:http").IncomingMessage} request @param {URL} url */
export async function accountAccessRoute(request, url) {
  const { pathname } = url;
  const json = (/** @type {unknown} */ value, status = 200) => ({
    status,
    value,
  });
  if (pathname === "/__account-access" && request.method === "GET") {
    const checkpoint = url.searchParams.get("checkpoint");
    if (checkpoint === "activation") return json(fixture.activationReads);
    if (checkpoint === "begin" || checkpoint === "confirm") {
      const gate = fixture[checkpoint];
      if (gate === null) return json(null, 409);
      await gate.entered.promise;
    }
    return json(fixture.confirms);
  }
  if (pathname === "/__account-access" && request.method === "POST") {
    switch (url.searchParams.get("action")) {
      case "reset":
        fixture.begin?.release.resolve();
        fixture.confirm?.release.resolve();
        fixture = state();
        break;
      case "hold-begin":
        fixture.begin = hold();
        break;
      case "release-begin":
        fixture.begin?.release.resolve();
        fixture.begin = null;
        break;
      case "hold-confirm":
        fixture.confirm = hold();
        break;
      case "release-confirm":
        fixture.confirm?.release.resolve();
        fixture.confirm = null;
        break;
      case "linked":
        fixture.confirmation = "linked";
        break;
      case "confirm-unavailable":
        fixture.confirmation = "unavailable";
        break;
      case "active":
        fixture.activation = "active";
        break;
      default:
        return json(null, 400);
    }
    return json({ ok: true });
  }
  if (pathname === `/telegram-activation-intents/${attemptId}`)
    return json({ product });
  const account = request.headers.authorization ?? "";
  const linkRef = accounts.get(account);
  if (linkRef === undefined) return null;
  if (pathname === "/account/profile" && request.method === "GET")
    return json({ kind: "missing" });
  if (pathname === "/accounts/current/legal-acceptances/terms")
    return json({
      ok: true,
      accepted: true,
      previouslyAccepted: true,
      document: {
        documentId: "terms",
        version: "navigation-terms",
        digest: "0".repeat(64),
        url: "https://example.test/terms",
      },
    });
  if (pathname === "/accounts/current/telegram-membership") {
    const link = fixture.linked.has(account)
      ? { kind: "linked" }
      : fixture.begun.has(account)
        ? { kind: "linking", expiresAt, linkRef }
        : { kind: "unlinked" };
    return json({ link, membership: { kind: "notOffered" } });
  }
  if (
    pathname === "/accounts/current/telegram-link" &&
    request.method === "POST"
  ) {
    const current = fixture;
    current.begin?.entered.resolve();
    await current.begin?.release.promise;
    current.begun.add(account);
    return json({ deepLink, expiresAt, linkRef, status: "pending" });
  }
  const confirmation =
    /^\/accounts\/current\/telegram-link\/([^/]+)\/confirm$/u.exec(pathname);
  if (confirmation !== null && request.method === "POST") {
    const current = fixture;
    const submitted = confirmation[1] ?? "";
    current.confirms.push({ account, linkRef: submitted });
    if (submitted !== linkRef || !current.begun.has(account))
      return json(null, 403);
    current.confirm?.entered.resolve();
    await current.confirm?.release.promise;
    if (current.confirmation === "unavailable") return json(null, 503);
    if (current.confirmation === "linked") current.linked.add(account);
    return json({ expiresAt, linkRef, status: current.confirmation });
  }
  if (pathname === `/accounts/current/telegram-activation/${attemptId}`) {
    fixture.activationReads++;
    return json({ product, state: fixture.activation });
  }
  return null;
}
