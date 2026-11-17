// @ts-check
import { learningScenario } from "../../../../scenarios/learning.mjs";
import {
  learningHttpProduct,
  learningHttpReader,
  learningHttpArtifacts,
} from "../../../../scenarios/learning-http.mjs";

/** This scenario owns only its named route, preserving denied/error doubles elsewhere.
 * @param {string | undefined} method @param {URL} url @param {boolean} entitled
 */
export function learningScenarioRoute(method, url, entitled) {
  if (method !== "GET") return undefined;
  const reader = learningHttpReader(
    url.pathname.slice("/materials/".length),
    entitled ? "holder" : "learner",
  );
  if (url.pathname.startsWith("/materials/") && reader !== undefined)
    return { status: 200, value: reader };
  if (url.pathname === `/products/${learningScenario.product.id}/artifacts`)
    return { status: 200, value: learningHttpArtifacts() };
  if (
    url.pathname ===
      `/products/${learningScenario.product.id}/artifacts/${learningScenario.artifact.id}/file` &&
    url.searchParams.get("version") === "1"
  )
    return {
      status: 200,
      contentType: learningScenario.artifact.contentType,
      headers: {
        "content-disposition": `attachment; filename="${learningScenario.artifact.filename}"`,
      },
      value: Buffer.from(learningScenario.artifact.text, "utf8"),
    };
  if (url.pathname !== `/library/products/${learningScenario.product.slug}`)
    return undefined;
  return {
    status: 200,
    value: learningHttpProduct(entitled ? "holder" : "learner"),
  };
}
