import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountProblemSchema,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  criterionHttpSchema,
  learnerSubject,
  learnerTaskFailureProblemSchema,
  learnerTaskUnavailableProblemSchema,
  taskCodeParamSchema,
  throwSystemError,
} from "../../adapters/nest/learner-task-http.js";
import {
  LEARNING_TASKS,
  type LearningTasks,
} from "../../facets/learning-tasks/learning-tasks.js";
import { taskPageQuerySchema } from "./read-task-page.js";

const placeSchema = {
  code: z.string(),
  title: z.string(),
  guide: z.object({ slug: z.string(), name: z.string() }).strict(),
  chapter: z.object({ name: z.string(), ordinal: z.number().int() }).strict(),
};

export const taskPageHttpSchema = z.discriminatedUnion("access", [
  z
    .object({
      access: z.literal("open"),
      task: z
        .object({
          ...placeSchema,
          access: z.enum(["free", "membership"]),
          version: z.number().int().positive(),
          definition: z
            .object({
              situation: z.string(),
              result: z.array(z.string()),
              freedom: z.string(),
              criteria: z.array(criterionHttpSchema),
            })
            .strict(),
        })
        .strict(),
      reviewProtocol: z
        .object({ version: z.string(), instructions: z.array(z.string()) })
        .strict(),
      relatedMaterials: z.array(
        z
          .object({
            slug: z.string(),
            title: z.string(),
            availability: z.enum(["available", "locked", "unavailable"]),
          })
          .strict(),
      ),
      submission: z.object({ accepting: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      access: z.literal("closed"),
      task: z.object(placeSchema).strict(),
    })
    .strict(),
]);

@ApiTags("Guide tasks")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("library/guides")
export class ReadTaskPageController {
  constructor(
    @Inject(LEARNING_TASKS)
    private readonly tasks: Pick<LearningTasks, "page">,
  ) {}

  @Get(":slug/tasks/:code")
  @ApiOperation({
    operationId: "readGuideTaskPage",
    summary:
      "Read a Guide Task page: the full current requirements when open, its place when closed",
  })
  @ApiParam({
    name: "slug",
    schema: toOpenApiSchema(taskPageQuerySchema.shape.guideSlug),
  })
  @ApiParam({ name: "code", schema: toOpenApiSchema(taskCodeParamSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(taskPageHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request_shape"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["task_not_found"]),
    ),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsOneOfContent(
      learnerTaskFailureProblemSchema,
      accountProblemSchema,
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      learnerTaskUnavailableProblemSchema,
      accountProblemSchema,
    ),
  })
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") guideSlug: string,
    @Param("code") code: string,
  ): Promise<z.infer<typeof taskPageHttpSchema>> {
    const result = await this.tasks.page({
      subject: learnerSubject(account),
      guideSlug,
      code,
    });
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
          throw problemException(400, error.code, "Task address is malformed");
        case "task_not_found":
          throw problemException(404, error.code, "Task is not found");
        case "dependency_unavailable":
        case "internal_error":
          throwSystemError(error, "Task page read");
      }
    }
    const page = result.value;
    const place = {
      code: page.task.code,
      title: page.task.title,
      guide: { slug: page.task.guide.slug, name: page.task.guide.name },
      chapter: {
        name: page.task.chapter.name,
        ordinal: page.task.chapter.ordinal,
      },
    };
    if (page.access === "closed") return { access: "closed", task: place };
    const definition = page.task.definition;
    return {
      access: "open",
      task: {
        code: place.code,
        title: place.title,
        guide: place.guide,
        chapter: place.chapter,
        access: page.task.access,
        version: page.task.version,
        definition: {
          situation: definition.situation,
          result: [...definition.result],
          freedom: definition.freedom,
          criteria: definition.criteria.map((criterion) => ({
            id: criterion.id,
            level: criterion.level,
            requirement: criterion.requirement,
            acceptableEvidence: [...criterion.acceptableEvidence],
          })),
        },
      },
      reviewProtocol: {
        version: page.reviewProtocol.version,
        instructions: [...page.reviewProtocol.instructions],
      },
      relatedMaterials: page.relatedMaterials.map((material) => ({
        slug: material.slug,
        title: material.title,
        availability: material.availability,
      })),
      submission: { accepting: page.submission.accepting },
    };
  }
}
