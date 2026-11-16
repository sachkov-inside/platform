// @ts-check
import { learningScenario } from "../../../../scenarios/learning.mjs";
import { learningHttpProduct } from "../../../../scenarios/learning-http.mjs";

/** This scenario owns only its named route, preserving denied/error doubles elsewhere.
 * @param {string | undefined} method @param {URL} url @param {boolean} entitled
 */
export function learningScenarioRoute(method, url, entitled) {
  if (
    method !== "GET" ||
    url.pathname !== `/library/products/${learningScenario.product.slug}`
  )
    return undefined;
  return {
    status: 200,
    value: learningHttpProduct(entitled ? "holder" : "learner"),
  };
}
