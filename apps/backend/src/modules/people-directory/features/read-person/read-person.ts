import { randomUUID } from "node:crypto";

import { z } from "zod";

import { hasText } from "../../../../infrastructure/contracts/text.js";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  authorizePeopleRead,
  failure,
  qualifiesByAccount,
  readPeople,
  type PeopleDirectoryDependencies,
  type PeopleDirectoryResult,
  type PersonIdentity,
} from "../../shared/people-composition.js";
import { byName, readProductNames } from "../../shared/product-names.js";

/** The newest payments the card shows; the payment list in Billing holds the rest. */
export const PERSON_PAYMENTS_LIMIT = 20;
/** Products per learning summary read, the bound of Reading Activity. */
const LEARNING_CHUNK = 50;
/** Accounts per identities read, the bound of the directory facts read. */
const ACTOR_CHUNK = 100;

type ProductOrigin =
  "paid" | "manual" | "course_activation" | "legacy" | "unknown";

/** Who recorded an event: Billing, Course Activation and the migration record no Account. */
export type PersonHistoryActor =
  | { readonly kind: "system" }
  | {
      readonly kind: "person";
      readonly accountId: string;
      /** The actor's title (name, @username, email), or null when none is known. */
      readonly label: string | null;
    }
  | { readonly kind: "unknown" };

export interface PersonHistoryEvent {
  readonly kind:
    | "purchase"
    | "activation"
    | "manual_issue"
    | "transfer"
    | "revoke"
    | "restore"
    | "migrate"
    | "other";
  readonly at: string;
  readonly actor: PersonHistoryActor;
  readonly reason: string | null;
}

export interface PersonProduct {
  readonly productId: string;
  readonly name: string;
  readonly access: "active" | "revoked";
  /** The Product Access revision a revocation or restore must name. */
  readonly revision: number;
  readonly firstIssuedAt: string | null;
  readonly origin: ProductOrigin;
  /** Newest first. */
  readonly history: readonly PersonHistoryEvent[];
}

export interface PersonPayment {
  /** Billing's purchase reference, which its payment page opens. */
  readonly paymentId: string;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly amountKopecks: number;
  /** Billing's own payment state. */
  readonly state: string;
  readonly createdAt: string;
  /** Only the Payment Link this payment was made through; no Order Email. */
  readonly paymentLinkId: string | null;
}

export interface PersonLearning {
  readonly productId: string;
  readonly name: string;
  readonly startedAt: string | null;
  readonly progress:
    | {
        readonly state: "measured";
        readonly read: number;
        readonly total: number;
        readonly lastActivityAt: string | null;
      }
    | { readonly state: "unavailable" };
}

/** No person data: the card already names the person, and no email stands beside submissions. */
export interface PersonSubmissions {
  readonly productId: string;
  readonly count: number;
  readonly lastSubmittedAt: string;
  readonly lastTaskCode: string | null;
}

export interface PersonTelegram {
  readonly link: "linked" | "not_linked";
  readonly membership: "member" | "not_member" | "unknown";
  readonly restriction: "none" | "moderation" | "external_unknown" | "unknown";
  readonly marketing: "enabled" | "stopped" | "unknown";
  readonly observedAt: string | null;
}

export interface PersonWaitlist {
  readonly productId: string;
  readonly productName: string | null;
  readonly intakeName: string;
  readonly active: boolean;
  readonly joinedAt: string;
}

type Ready<Value> = { readonly state: "ready" } & Value;
type Unavailable = { readonly state: "unavailable" };
type Block<Value> = Ready<Value> | Unavailable;

export interface PersonCard {
  readonly person: PersonIdentity & {
    readonly registeredAt: string;
    readonly telegramUrl: string | null;
  };
  readonly products: Block<{ readonly items: readonly PersonProduct[] }>;
  readonly payments: Block<{ readonly items: readonly PersonPayment[] }>;
  readonly learning: Block<{ readonly items: readonly PersonLearning[] }>;
  /** `forbidden` without `materials:manage`, the right of the submissions list. */
  readonly submissions:
    | Block<{ readonly items: readonly PersonSubmissions[] }>
    | { readonly state: "forbidden" };
  readonly telegram: Block<PersonTelegram>;
  readonly waitlists: Block<{ readonly items: readonly PersonWaitlist[] }>;
}

export type ReadPersonResult = PeopleDirectoryResult<
  PersonCard,
  "invalid_request" | "forbidden" | "not_found" | "dependency_unavailable"
>;

const unavailable = { state: "unavailable" } as const;

/**
 * The person card (#1721) for the owner. The header is required: an Account that does not exist
 * or is no person is `not_found`. Every other block comes from its own owner and fails on its own,
 * so one owner's failure, already recorded by that owner, leaves the others answering.
 */
export async function readPerson(
  dependencies: PeopleDirectoryDependencies,
  actorId: string,
  input: unknown,
): Promise<ReadPersonResult> {
  // The right comes first: another role is refused whatever it sends.
  const refused = await authorizePeopleRead(dependencies, actorId);
  if (refused !== undefined) return refused;
  const parsed = z.uuid().toLowerCase().safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  const accountId = parsed.data;

  const [facts, bindings] = await Promise.all([
    dependencies.directory.readDirectoryFacts([accountId]),
    dependencies.telegram.readBindings([accountId]),
  ]);
  if (!facts.ok || !bindings.ok) return failure("dependency_unavailable");
  const fact = facts.facts.get(accountId);
  const binding = bindings.bindings.get(accountId);
  const linked =
    binding?.accountRef != null && binding.telegramIdentityRef !== null;
  if (fact === undefined || !(qualifiesByAccount(fact) || linked))
    return failure("not_found");

  const [contacts, access, payments, submissions, member, waitlists] =
    await Promise.all([
      linked
        ? guarded(() =>
            dependencies.telegram.readContactsWithMarketing([accountId]),
          )
        : undefined,
      guarded(() =>
        dependencies.access.readAccountProductAccess(actorId, accountId),
      ),
      guarded(() =>
        dependencies.payments.execute(actorId, {
          operation: "payments.list",
          operationId: randomUUID(),
          accountId,
          limit: PERSON_PAYMENTS_LIMIT,
        }),
      ),
      guarded(() =>
        dependencies.submissions.summarizeAccount(actorId, accountId),
      ),
      guarded(() => dependencies.community.readMemberState(accountId)),
      guarded(() => dependencies.waitlists.readForAccount(accountId)),
    ]);

  const products = access?.ok === true ? access.value.products : undefined;
  const productIds = products?.map((product) => product.productId) ?? [];
  const [learning, names, actors] = await Promise.all([
    products === undefined
      ? undefined
      : readLearning(dependencies, accountId, productIds),
    readProductNames(
      dependencies,
      [
        ...new Set([
          ...productIds,
          ...(waitlists?.ok === true
            ? waitlists.value.map((item) => item.productId)
            : []),
        ]),
      ],
      "readPerson",
    ),
    products === undefined
      ? new Map<string, string | null>()
      : readActorLabels(
          dependencies,
          products.flatMap((product) =>
            product.history.flatMap((event) =>
              event.actor.state === "known" && event.actor.actorId !== null
                ? [event.actor.actorId]
                : [],
            ),
          ),
        ),
  ]);

  const contact =
    contacts?.ok === true ? contacts.contacts.get(accountId) : undefined;
  const namesUnknown = linked && contact?.telegramContactState !== "available";
  return {
    ok: true,
    value: {
      person: {
        accountId,
        displayName: contact?.displayName ?? null,
        username: contact?.telegramUsername ?? null,
        email: fact.billingEmail,
        contactsState:
          namesUnknown || fact.billingEmailState === "unavailable"
            ? "partial"
            : "complete",
        registeredAt: fact.registeredAt.toISOString(),
        telegramUrl: contact?.telegramUrl ?? null,
      },
      products:
        products === undefined || names === undefined
          ? unavailable
          : {
              state: "ready",
              items: products
                .map((product): PersonProduct => ({
                  productId: product.productId,
                  name: names.get(product.productId) ?? "",
                  access: product.access,
                  revision: product.revision,
                  firstIssuedAt: product.firstIssuedAt,
                  origin: product.origin,
                  history: product.history
                    .map((event): PersonHistoryEvent => ({
                      kind: event.kind,
                      at: event.at,
                      actor:
                        event.actor.state === "unknown"
                          ? { kind: "unknown" }
                          : event.actor.actorId === null
                            ? { kind: "system" }
                            : {
                                kind: "person",
                                accountId: event.actor.actorId,
                                label: actors.get(event.actor.actorId) ?? null,
                              },
                      reason: hasText(event.reason) ? event.reason : null,
                    }))
                    .reverse(),
                }))
                .sort(byName),
            },
      payments:
        payments?.ok === true && payments.result.outcome === "payments"
          ? {
              state: "ready",
              items: payments.result.items.map((payment) => ({
                paymentId: payment.purchaseRef,
                productId: payment.snapshot.product?.id ?? null,
                productName: payment.snapshot.product?.name ?? null,
                amountKopecks: payment.amountKopecks,
                state: payment.state,
                createdAt: payment.createdAt,
                paymentLinkId:
                  payment.snapshot.individualPayment?.linkId ?? null,
              })),
            }
          : unavailable,
      learning:
        learning === undefined || names === undefined
          ? unavailable
          : {
              state: "ready",
              items: learning
                .map((item) => ({
                  productId: item.productId,
                  name: names.get(item.productId) ?? "",
                  startedAt: item.startedAt,
                  progress:
                    item.progress.state === "measured"
                      ? {
                          state: "measured" as const,
                          read: item.progress.read,
                          total: item.progress.total,
                          lastActivityAt: item.progress.lastActivityAt,
                        }
                      : { state: "unavailable" as const },
                }))
                .sort(byName),
            },
      submissions:
        submissions === undefined
          ? unavailable
          : submissions.ok
            ? {
                state: "ready",
                items: submissions.value.map((summary) => ({
                  productId: summary.productId,
                  count: summary.count,
                  lastSubmittedAt: summary.lastSubmission.submittedAt,
                  lastTaskCode: summary.lastSubmission.taskCode,
                })),
              }
            : submissions.error.code === "forbidden"
              ? { state: "forbidden" }
              : unavailable,
      telegram:
        member?.ok === true
          ? {
              state: "ready",
              link: member.value.link.state,
              membership: member.value.membership,
              restriction: member.value.restriction,
              // The `/stop` state comes with the live contact read; without it, unknown.
              marketing: contact?.marketing ?? "unknown",
              observedAt: member.value.observedAt,
            }
          : unavailable,
      waitlists:
        waitlists?.ok === true
          ? {
              state: "ready",
              items: waitlists.value.map((item) => ({
                productId: item.productId,
                productName: names?.get(item.productId) ?? null,
                intakeName: item.intakeName,
                active: item.active,
                joinedAt: item.joinedAt,
              })),
            }
          : unavailable,
    },
  };
}

/**
 * One owner's block: its own failure union stays as it is; a throw, which the owner did not
 * turn into a result, is recorded here and leaves only this block unavailable.
 */
async function guarded<Value>(
  read: () => Promise<Value>,
): Promise<Value | undefined> {
  try {
    return await read();
  } catch (error) {
    reportDependencyFailure(
      { module: "people-directory", operation: "readPerson" },
      error,
    );
    return undefined;
  }
}

async function readLearning(
  dependencies: Pick<PeopleDirectoryDependencies, "learning">,
  accountId: string,
  productIds: readonly string[],
) {
  const items = [];
  for (let offset = 0; offset < productIds.length; offset += LEARNING_CHUNK) {
    const read = await guarded(() =>
      dependencies.learning.readLearningSummary(
        accountId,
        productIds.slice(offset, offset + LEARNING_CHUNK),
      ),
    );
    if (read?.ok !== true) return undefined;
    items.push(...read.value);
  }
  return items;
}

/**
 * The title of each history actor as the owner sees people: name, @username, then email. An
 * actor who is no person, or whose identity cannot be read now, has no label.
 */
async function readActorLabels(
  dependencies: Pick<PeopleDirectoryDependencies, "directory" | "telegram">,
  actorIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const ids = [...new Set(actorIds.map((id) => id.toLowerCase()))];
  const labels = new Map<string, string | null>();
  for (let offset = 0; offset < ids.length; offset += ACTOR_CHUNK) {
    const read = await guarded(() =>
      readPeople(dependencies, ids.slice(offset, offset + ACTOR_CHUNK)),
    );
    if (read?.ok !== true) continue;
    for (const person of read.value)
      labels.set(
        person.accountId,
        person.displayName ??
          (person.username === null ? null : `@${person.username}`) ??
          person.email,
      );
  }
  return labels;
}
