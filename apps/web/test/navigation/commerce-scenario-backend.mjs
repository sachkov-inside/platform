// @ts-check
import { z } from "zod";
import {
  commerceScenario as facts,
  commerceFixtureFacts as preview,
} from "../../../../scenarios/commerce.mjs";
import {
  commerceHttpPayments,
  commerceHttpPeople,
} from "../../../../scenarios/commerce-http.mjs";

/** Only the named token selects this scenario. Existing empty/denied/error scenarios retain their routes.
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 */
export async function commerceScenarioRoute(request, url, readBody) {
  if (request.headers.authorization !== "Bearer synthetic-commerce-owner")
    return null;
  if (request.method === "GET") {
    if (url.pathname === "/authoring/people")
      return { status: 200, value: commerceHttpPeople() };
    if (url.pathname === "/authoring/people/product-choices")
      return {
        status: 200,
        value: {
          items: [
            {
              productId: facts.product.id,
              name: facts.product.name,
              archived: false,
            },
          ],
        },
      };
    if (url.pathname === "/authoring/people/identities")
      return {
        status: 200,
        value: {
          items: [
            {
              accountId: preview.buyerAccountId,
              displayName: facts.telegram.displayName,
              username: facts.telegram.username,
              email: preview.buyerEmail,
              contactsState: "complete",
            },
          ],
        },
      };
  }
  if (url.pathname === "/billing/admin" && request.method === "POST") {
    const command = z
      .object({ operation: z.string() })
      .parse(JSON.parse(await readBody(request)));
    if (command.operation === "payments.list")
      return { status: 200, value: commerceHttpPayments() };
    if (command.operation === "content.list")
      return {
        status: 200,
        value: {
          operationRef: preview.operationRef,
          result: {
            outcome: "content",
            items: [
              {
                kind: "product",
                id: facts.product.id,
                title: facts.product.name,
                available: true,
              },
            ],
          },
        },
      };
    return { status: 400, value: { code: "invalid_request" } };
  }
  return null;
}
