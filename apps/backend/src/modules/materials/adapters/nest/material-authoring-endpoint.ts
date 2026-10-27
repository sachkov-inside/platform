import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";
import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import { materialAuthoringProblemSchema } from "./material-authoring-http.js";
export { AuthoringEndpoint as MaterialAuthoringEndpoint } from "../../../accounts/index.js";

export function ApiMaterialAuthoringErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        content: problemDetailsContent(materialAuthoringProblemSchema),
      }),
    ),
  );
}
