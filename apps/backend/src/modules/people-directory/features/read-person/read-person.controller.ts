import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  accountProblemSchema,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { PeopleDirectory } from "../../facets/people-directory/people-directory.js";
import {
  peopleDirectoryProblem,
  personIdentityHttpSchema,
} from "../../shared/people-http.js";
import { productAccessOriginSchema } from "../../../account-rights/index.js";
import {
  PERSON_PAYMENTS_LIMIT,
  type PersonCard,
  type PersonHistoryActor,
} from "./read-person.js";

const unavailableHttpSchema = z
  .object({ state: z.literal("unavailable") })
  .strict();

/** A block its owner answered, or `unavailable` when that owner failed now. */
function blockHttpSchema<const Shape extends z.ZodRawShape>(shape: Shape) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("ready"), ...shape }).strict(),
    unavailableHttpSchema,
  ]);
}

const historyActorHttpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("system") }).strict(),
  z
    .object({
      kind: z.literal("person"),
      accountId: z.uuid(),
      label: z.string().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);

const personCardHttpSchema = z
  .object({
    person: personIdentityHttpSchema
      .extend({
        registeredAt: z.iso.datetime(),
        telegramUrl: z.string().nullable(),
      })
      .strict(),
    products: blockHttpSchema({
      items: z.array(
        z
          .object({
            productId: z.uuid(),
            name: z.string(),
            access: z.enum(["active", "revoked"]),
            revision: z.int().positive(),
            firstIssuedAt: z.iso.datetime().nullable(),
            origin: productAccessOriginSchema,
            history: z.array(
              z
                .object({
                  kind: z.enum([
                    "purchase",
                    "activation",
                    "manual_issue",
                    "transfer",
                    "revoke",
                    "restore",
                    "migrate",
                    "other",
                  ]),
                  at: z.iso.datetime(),
                  actor: historyActorHttpSchema,
                  reason: z.string().nullable(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    }),
    payments: blockHttpSchema({
      items: z
        .array(
          z
            .object({
              paymentId: z.uuid(),
              productId: z.uuid().nullable(),
              productName: z.string().nullable(),
              amountKopecks: z.int(),
              state: z.string(),
              createdAt: z.iso.datetime(),
              paymentLinkId: z.string().nullable(),
            })
            .strict(),
        )
        .max(PERSON_PAYMENTS_LIMIT),
    }),
    learning: blockHttpSchema({
      items: z.array(
        z
          .object({
            productId: z.uuid(),
            name: z.string(),
            startedAt: z.iso.datetime().nullable(),
            progress: z.discriminatedUnion("state", [
              z
                .object({
                  state: z.literal("measured"),
                  read: z.int().min(0),
                  total: z.int().min(0),
                  lastActivityAt: z.iso.datetime().nullable(),
                })
                .strict(),
              z.object({ state: z.literal("unavailable") }).strict(),
            ]),
          })
          .strict(),
      ),
    }),
    submissions: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("ready"),
          items: z.array(
            z
              .object({
                productId: z.uuid(),
                count: z.int().min(0),
                lastSubmittedAt: z.iso.datetime(),
                lastTaskCode: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
      z.object({ state: z.literal("forbidden") }).strict(),
      unavailableHttpSchema,
    ]),
    telegram: blockHttpSchema({
      link: z.enum(["linked", "not_linked"]),
      membership: z.enum(["member", "not_member", "unknown"]),
      restriction: z.enum([
        "none",
        "moderation",
        "external_unknown",
        "unknown",
      ]),
      marketing: z.enum(["enabled", "stopped", "unknown"]),
      observedAt: z.iso.datetime().nullable(),
    }),
    waitlists: blockHttpSchema({
      items: z.array(
        z
          .object({
            productId: z.uuid(),
            productName: z.string().nullable(),
            intakeName: z.string(),
            active: z.boolean(),
            joinedAt: z.iso.datetime(),
          })
          .strict(),
      ),
    }),
  })
  .strict();

type PersonCardHttp = z.infer<typeof personCardHttpSchema>;

@ApiTags("People")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/people")
export class ReadPersonController {
  constructor(
    @Inject(PeopleDirectory) private readonly directory: PeopleDirectory,
  ) {}

  @Get(":accountId")
  @ApiOperation({
    operationId: "readPerson",
    summary:
      "Read the person card for the owner: header, Products with their history, payments, learning, submissions, Telegram and waitlists; each block answers on its own and is unavailable when its owner fails, submissions also need materials:manage",
  })
  @ApiParam({ name: "accountId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(personCardHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async read(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("accountId") accountId: string,
  ): Promise<PersonCardHttp> {
    const result = await this.directory.readPerson(
      account.accountId,
      accountId,
    );
    if (!result.ok) throw peopleDirectoryProblem(result.error);
    return personCardHttp(result.value);
  }
}

function personCardHttp(card: PersonCard): PersonCardHttp {
  const { person } = card;
  return {
    person: {
      accountId: person.accountId,
      displayName: person.displayName,
      username: person.username,
      email: person.email,
      contactsState: person.contactsState,
      registeredAt: person.registeredAt,
      telegramUrl: person.telegramUrl,
    },
    products:
      card.products.state === "ready"
        ? {
            state: "ready",
            items: card.products.items.map((product) => ({
              productId: product.productId,
              name: product.name,
              access: product.access,
              revision: product.revision,
              firstIssuedAt: product.firstIssuedAt,
              origin: product.origin,
              history: product.history.map((event) => ({
                kind: event.kind,
                at: event.at,
                actor: actorHttp(event.actor),
                reason: event.reason,
              })),
            })),
          }
        : { state: "unavailable" },
    payments:
      card.payments.state === "ready"
        ? {
            state: "ready",
            items: card.payments.items.map((payment) => ({
              paymentId: payment.paymentId,
              productId: payment.productId,
              productName: payment.productName,
              amountKopecks: payment.amountKopecks,
              state: payment.state,
              createdAt: payment.createdAt,
              paymentLinkId: payment.paymentLinkId,
            })),
          }
        : { state: "unavailable" },
    learning:
      card.learning.state === "ready"
        ? {
            state: "ready",
            items: card.learning.items.map((item) => ({
              productId: item.productId,
              name: item.name,
              startedAt: item.startedAt,
              progress:
                item.progress.state === "measured"
                  ? {
                      state: "measured",
                      read: item.progress.read,
                      total: item.progress.total,
                      lastActivityAt: item.progress.lastActivityAt,
                    }
                  : { state: "unavailable" },
            })),
          }
        : { state: "unavailable" },
    submissions:
      card.submissions.state === "ready"
        ? {
            state: "ready",
            items: card.submissions.items.map((item) => ({
              productId: item.productId,
              count: item.count,
              lastSubmittedAt: item.lastSubmittedAt,
              lastTaskCode: item.lastTaskCode,
            })),
          }
        : { state: card.submissions.state },
    telegram:
      card.telegram.state === "ready"
        ? {
            state: "ready",
            link: card.telegram.link,
            membership: card.telegram.membership,
            restriction: card.telegram.restriction,
            marketing: card.telegram.marketing,
            observedAt: card.telegram.observedAt,
          }
        : { state: "unavailable" },
    waitlists:
      card.waitlists.state === "ready"
        ? {
            state: "ready",
            items: card.waitlists.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              intakeName: item.intakeName,
              active: item.active,
              joinedAt: item.joinedAt,
            })),
          }
        : { state: "unavailable" },
  };
}

function actorHttp(
  actor: PersonHistoryActor,
): z.infer<typeof historyActorHttpSchema> {
  switch (actor.kind) {
    case "system":
      return { kind: "system" };
    case "unknown":
      return { kind: "unknown" };
    case "person":
      return {
        kind: "person",
        accountId: actor.accountId,
        label: actor.label,
      };
  }
}
