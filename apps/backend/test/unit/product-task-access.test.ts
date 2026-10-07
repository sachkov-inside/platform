import { describe, expect, test } from "vitest";

import { accountId } from "../../src/modules/accounts/index.js";
import {
  anonymousSubject,
  assembleContentAccess,
  type ProductTaskResourceFacts,
  type MembershipAccessState,
  type Subject,
} from "../../src/modules/content-access/index.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const learner: Subject = {
  kind: "account",
  accountId: accountId("33333333-3333-4333-8333-333333333333"),
};

function access(
  facts: Omit<ProductTaskResourceFacts, "taskId" | "productId" | "version">,
  options: {
    readonly manager?: boolean;
    readonly membership?: MembershipAccessState;
  } = {},
) {
  const membershipRequests: (readonly string[] | undefined)[] = [];
  const task = { taskId, productId, version: 2, ...facts };
  const contentAccess = assembleContentAccess({
    materialResourceFacts: {
      findMany: () => Promise.resolve([]),
      findOne: () => Promise.resolve(null),
    },
    productTaskResourceFacts: {
      findMany: () => Promise.resolve([task]),
      findOne: () => Promise.resolve(task),
    },
    accountPermissions: {
      hasMaterialsManage: () => Promise.resolve(options.manager === true),
    },
    accountRights: {
      resolveForAccess: (_account, productIds) => {
        membershipRequests.push(productIds);
        return Promise.resolve(options.membership ?? { kind: "required" });
      },
    },
  });
  const decide = (subject: Subject) =>
    contentAccess.authorize({
      subject,
      resource: { kind: "productTask", taskId },
      action: "read",
      enforcementPoint: "product_task_read",
      correlationId: "product-task-access",
    });
  const availability = async (subject: Subject) => {
    const result = await contentAccess.checkAvailabilityMany({
      subject,
      operations: [
        {
          itemId: taskId,
          resource: { kind: "productTask", taskId },
          action: "read",
        },
      ],
      enforcementPoint: "product_task_read",
      correlationId: "product-task-access",
    });
    return result.ok ? result.items[0]?.availability : undefined;
  };
  return { decide, availability, membershipRequests };
}

describe("Content Access on a Product Task (#946)", () => {
  test("a free published task is open to everyone", async () => {
    const free = access({ access: "free", published: true });
    for (const subject of [anonymousSubject, learner]) {
      expect(await free.decide(subject)).toMatchObject({
        effect: "allow",
        reason: "public_resource",
        checkedContentVersion: 2,
      });
      expect(await free.availability(subject)).toBe("available");
    }
  });

  test("a paid task opens through the Product of the task, which Membership Entitlements judge", async () => {
    const open = access(
      { access: "closed", published: true },
      { membership: { kind: "active", validUntil: null } },
    );
    expect(await open.decide(learner)).toMatchObject({
      effect: "allow",
      reason: "active_membership",
    });
    // `product:<id>` and a `materials` Coverage covering the Product both answer for this Product.
    expect(open.membershipRequests).toEqual([[productId]]);
    const closed = access({ access: "closed", published: true });
    expect(await closed.decide(learner)).toMatchObject({
      effect: "deny",
      reason: "membership_required",
    });
    expect(await closed.availability(learner)).toBe("locked");
    expect(await closed.decide(anonymousSubject)).toMatchObject({
      effect: "deny",
      reason: "authentication_required",
    });
  });

  test("an unpublished task is closed to everyone except its author", async () => {
    for (const taskAccess of ["free", "closed"] as const) {
      const learnerView = access(
        { access: taskAccess, published: false },
        { membership: { kind: "active", validUntil: null } },
      );
      expect(await learnerView.decide(learner)).toMatchObject({
        effect: "deny",
        reason: "resource_unpublished",
      });
      expect(await learnerView.availability(learner)).toBe("unavailable");
      expect(await learnerView.decide(anonymousSubject)).toMatchObject({
        effect: "deny",
      });
      expect(await learnerView.availability(anonymousSubject)).toBe(
        "unavailable",
      );
      const author = access(
        { access: taskAccess, published: false },
        { manager: true },
      );
      expect(await author.decide(learner)).toMatchObject({
        effect: "allow",
        reason: "materials_manager",
      });
      expect(await author.availability(learner)).toBe("available");
    }
  });
});
