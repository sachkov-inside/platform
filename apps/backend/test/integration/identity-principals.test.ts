import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createIdentityPrincipals,
  type IdentityPrincipals,
} from "../../src/modules/identity-principals/index.js";
import { createDeterministicExternalIdentityProof } from "../../src/modules/identity-principals/infrastructure/idp/fake/deterministic-external-identity-proof.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("IdentityPrincipals", () => {
  let identityPrincipals: IdentityPrincipals;
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    identityPrincipals = createIdentityPrincipals({
      database: testDatabase.database,
      emailFingerprintKey: "test-email-fingerprint-key",
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("establishes, resolves and ends one finite human session", async () => {
    const proof = humanProof("human-001", "Member@Example.Test");
    const verified = await proof.verifyHumanSignIn("firstSignIn");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    const established = await identityPrincipals.establishHumanSession({
      identity: verified.identity,
      idempotencyKey: "sign-in-attempt-001",
    });

    expect(established).toMatchObject({
      ok: true,
      subject: {
        principalKind: "human",
        authenticatedAt: "2026-08-25T06:00:00.000Z",
        permissions: [],
      },
    });
    if (!established.ok) {
      return;
    }

    const resolved = await identityPrincipals.resolveSubject({
      identity: verified.sessionIdentity,
      sessionRef: established.subject.sessionRef,
    });
    expect(resolved).toEqual({ ok: true, subject: established.subject });

    const ended = await identityPrincipals.endSession({
      identity: verified.sessionIdentity,
      idempotencyKey: "sign-out-attempt-001",
      sessionRef: established.subject.sessionRef,
    });
    expect(ended).toEqual({ ok: true, ended: true });
    await expect(
      identityPrincipals.endSession({
        identity: verified.sessionIdentity,
        idempotencyKey: "sign-out-attempt-001",
        sessionRef: established.subject.sessionRef,
      }),
    ).resolves.toEqual({ ok: true, ended: true });

    const second = await identityPrincipals.establishHumanSession({
      identity: verified.identity,
      idempotencyKey: "sign-in-attempt-002",
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      await expect(
        identityPrincipals.endSession({
          identity: verified.sessionIdentity,
          idempotencyKey: "sign-out-attempt-001",
          sessionRef: second.subject.sessionRef,
        }),
      ).resolves.toEqual({
        ok: false,
        error: { code: "idempotency_key_reused" },
      });
    }

    await expect(
      identityPrincipals.resolveSubject({
        identity: verified.sessionIdentity,
        sessionRef: established.subject.sessionRef,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "session_ended" } });
  });

  test("replays one sign-in effect and rejects a reused key for another identity", async () => {
    const proof = humanProof("human-idempotent", "idempotent@example.test");
    const verified = await proof.verifyHumanSignIn("firstSignIn");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    const command = {
      identity: verified.identity,
      idempotencyKey: "sign-in-idempotent",
    } as const;
    const first = await identityPrincipals.establishHumanSession(command);
    const replay = await identityPrincipals.establishHumanSession(command);

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);

    const anotherProof = humanProof("human-idempotent-other", "other@example.test");
    const anotherVerified = await anotherProof.verifyHumanSignIn("firstSignIn");
    expect(anotherVerified.ok).toBe(true);
    if (!anotherVerified.ok) {
      return;
    }
    await expect(
      identityPrincipals.establishHumanSession({
        identity: anotherVerified.identity,
        idempotencyKey: command.idempotencyKey,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "idempotency_key_reused" },
    });
  });

  test("keeps issuer and subject authoritative when verified email changes", async () => {
    const firstProof = humanProof("human-email-change", "before@example.test");
    const firstVerified = await firstProof.verifyHumanSignIn("firstSignIn");
    expect(firstVerified.ok).toBe(true);
    if (!firstVerified.ok) {
      return;
    }
    const first = await identityPrincipals.establishHumanSession({
      identity: firstVerified.identity,
      idempotencyKey: "email-change-before",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const changedProof = humanProof("human-email-change", "after@example.test");
    const changedVerified = await changedProof.verifyHumanSignIn("firstSignIn");
    expect(changedVerified.ok).toBe(true);
    if (!changedVerified.ok) {
      return;
    }
    const returning = await identityPrincipals.establishHumanSession({
      identity: changedVerified.identity,
      idempotencyKey: "email-change-after",
    });

    expect(returning).toMatchObject({
      ok: true,
      subject: { principalId: first.subject.principalId },
    });
  });

  test("fails a new identity closed when verified email belongs to another Principal", async () => {
    const ownerProof = humanProof("human-email-owner", "duplicate@example.test");
    const ownerVerified = await ownerProof.verifyHumanSignIn("firstSignIn");
    expect(ownerVerified.ok).toBe(true);
    if (!ownerVerified.ok) {
      return;
    }
    await identityPrincipals.establishHumanSession({
      identity: ownerVerified.identity,
      idempotencyKey: "duplicate-email-owner",
    });

    const conflictProof = humanProof("human-email-conflict", " DUPLICATE@example.test ");
    const conflictVerified = await conflictProof.verifyHumanSignIn("firstSignIn");
    expect(conflictVerified.ok).toBe(true);
    if (!conflictVerified.ok) {
      return;
    }
    await expect(
      identityPrincipals.establishHumanSession({
        identity: conflictVerified.identity,
        idempotencyKey: "duplicate-email-conflict",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_conflict" } });

    await expect(
      testDatabase.database
        .selectFrom("identity_audit_events")
        .select(["principal_id", "session_id"])
        .where("operation", "=", "establish_human_session")
        .where("outcome", "=", "identity_conflict_duplicate_email")
        .executeTakeFirst(),
    ).resolves.toEqual({ principal_id: null, session_id: null });
  });

  test("keeps the original email observation and audits a changed-email conflict", async () => {
    const original = await verifiedHuman("human-email-conflict-original", "original@example.test");
    const owner = await verifiedHuman("human-email-conflict-owner", "owner@example.test");
    const originalSession = await identityPrincipals.establishHumanSession({
      identity: original.identity,
      idempotencyKey: "changed-email-conflict-original",
    });
    await identityPrincipals.establishHumanSession({
      identity: owner.identity,
      idempotencyKey: "changed-email-conflict-owner",
    });
    expect(originalSession.ok).toBe(true);
    if (!originalSession.ok) {
      return;
    }

    const conflicting = await verifiedHuman(
      "human-email-conflict-original",
      "owner@example.test",
    );
    await expect(
      identityPrincipals.establishHumanSession({
        identity: conflicting.identity,
        idempotencyKey: "changed-email-conflict-observation",
      }),
    ).resolves.toMatchObject({
      ok: true,
      subject: { principalId: originalSession.subject.principalId },
    });

    await expect(
      testDatabase.database
        .selectFrom("identity_audit_events")
        .select(["principal_id", "session_id"])
        .where("operation", "=", "establish_human_session")
        .where("outcome", "=", "email_observation_conflict")
        .where("principal_id", "=", originalSession.subject.principalId)
        .executeTakeFirst(),
    ).resolves.toEqual({
      principal_id: originalSession.subject.principalId,
      session_id: null,
    });
  });

  test("concurrent callback retries return one Principal and one session effect", async () => {
    const proof = humanProof("human-concurrent", "concurrent@example.test");
    const verified = await proof.verifyHumanSignIn("firstSignIn");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        identityPrincipals.establishHumanSession({
          identity: verified.identity,
          idempotencyKey: "concurrent-callback",
        }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const subjects = results.flatMap((result) => (result.ok ? [result.subject] : []));
    expect(new Set(subjects.map(({ principalId }) => principalId)).size).toBe(1);
    expect(new Set(subjects.map(({ sessionRef }) => sessionRef)).size).toBe(1);
  });

  test("concurrent first sign-ins with distinct attempts converge on one Principal", async () => {
    const proof = humanProof("human-concurrent-distinct", "concurrent-distinct@example.test");
    const verified = await proof.verifyHumanSignIn("firstSignIn");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        identityPrincipals.establishHumanSession({
          identity: verified.identity,
          idempotencyKey: `concurrent-distinct-${String(index)}`,
        }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const subjects = results.flatMap((result) => (result.ok ? [result.subject] : []));
    expect(new Set(subjects.map(({ principalId }) => principalId)).size).toBe(1);
  });

  test("checks current local state and grants instead of provider claims", async () => {
    const proof = humanProof("human-permissions", "permissions@example.test");
    const verified = await proof.verifyHumanSignIn("firstSignIn");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    const established = await identityPrincipals.establishHumanSession({
      identity: verified.identity,
      idempotencyKey: "permissions-session",
    });
    expect(established.ok).toBe(true);
    if (!established.ok) {
      return;
    }

    await expect(
      identityPrincipals.checkPermission({
        principalId: established.subject.principalId,
        permission: "materials:author",
      }),
    ).resolves.toEqual({ ok: true, allowed: false });

    await testDatabase.database
      .insertInto("principal_permissions")
      .values({
        principal_id: established.subject.principalId,
        permission: "materials:author",
      })
      .execute();
    await expect(
      identityPrincipals.checkPermission({
        principalId: established.subject.principalId,
        permission: "materials:author",
      }),
    ).resolves.toEqual({ ok: true, allowed: true });

    await testDatabase.database
      .updateTable("principals")
      .set({ state: "disabled", security_version: 2 })
      .where("id", "=", established.subject.principalId)
      .execute();
    await expect(
      identityPrincipals.resolveSubject({
        identity: verified.sessionIdentity,
        sessionRef: established.subject.sessionRef,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "principal_disabled" } });
  });

  test("opens a service session only for an explicitly provisioned service Principal", async () => {
    const proof = createDeterministicExternalIdentityProof({
      service: {
        outcome: "verified_service",
        identity: {
          issuer: "https://identity.example.test/oidc",
          subject: "service-mcp",
          authenticatedAt: "2026-08-25T06:00:00.000Z",
        },
      },
    });
    const verified = await proof.verifyServiceSession("service");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    await expect(
      identityPrincipals.establishServiceSession({
        identity: verified.identity,
        idempotencyKey: "unknown-service",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "identity_not_found" } });

    const principalId = randomUUID();
    await testDatabase.database
      .insertInto("principals")
      .values({ id: principalId, kind: "service", state: "active" })
      .execute();
    await testDatabase.database
      .insertInto("external_identities")
      .values({
        id: randomUUID(),
        principal_id: principalId,
        issuer: verified.identity.issuer,
        subject: verified.identity.subject,
        email_fingerprint: null,
      })
      .execute();
    await testDatabase.database
      .insertInto("principal_permissions")
      .values({ principal_id: principalId, permission: "materials:author" })
      .execute();

    const knownServiceCommand = {
      identity: verified.identity,
      idempotencyKey: "known-service",
    } as const;
    const first = await identityPrincipals.establishServiceSession(knownServiceCommand);
    expect(first).toMatchObject({
      ok: true,
      subject: {
        principalId,
        principalKind: "service",
        permissions: ["materials:author"],
      },
    });
    await expect(
      identityPrincipals.establishServiceSession(knownServiceCommand),
    ).resolves.toEqual(first);
  });

  test("raises assurance only through a bound one-time human re-authentication attempt", async () => {
    const proof = humanProof("human-reauth", "reauth@example.test");
    const verified = await proof.verifyHumanSignIn("firstSignIn");
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    const established = await identityPrincipals.establishHumanSession({
      identity: verified.identity,
      idempotencyKey: "reauth-session",
    });
    expect(established.ok).toBe(true);
    if (!established.ok) {
      return;
    }

    const begun = await identityPrincipals.beginHumanReauthentication({
      identity: verified.sessionIdentity,
      idempotencyKey: "reauth-begin",
      sessionRef: established.subject.sessionRef,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const reauthenticationProof = createDeterministicExternalIdentityProof({
      reauth: {
        outcome: "verified_reauthentication",
        proof: {
          issuer: verified.sessionIdentity.issuer,
          subject: verified.sessionIdentity.subject,
          reauthenticatedAt: new Date().toISOString(),
          attemptId: begun.attemptId,
          tokenId: "logto-jwt-jti-001",
        },
      },
    });
    const reauthenticated = await reauthenticationProof.verifyHumanReauthentication("reauth");
    expect(reauthenticated.ok).toBe(true);
    if (!reauthenticated.ok) {
      return;
    }

    const completed = await identityPrincipals.completeHumanReauthentication({
      proof: reauthenticated.proof,
      idempotencyKey: "reauth-complete",
      sessionRef: established.subject.sessionRef,
    });
    expect(completed).toMatchObject({
      ok: true,
      subject: {
        principalId: established.subject.principalId,
        sessionRef: established.subject.sessionRef,
        authenticatedAt: reauthenticated.proof.reauthenticatedAt,
      },
    });

    await expect(
      identityPrincipals.completeHumanReauthentication({
        proof: reauthenticated.proof,
        idempotencyKey: "reauth-complete",
        sessionRef: established.subject.sessionRef,
      }),
    ).resolves.toEqual(completed);

    const secondAttempt = await identityPrincipals.beginHumanReauthentication({
      identity: verified.sessionIdentity,
      idempotencyKey: "reauth-begin-second",
      sessionRef: established.subject.sessionRef,
    });
    expect(secondAttempt.ok).toBe(true);
    if (!secondAttempt.ok) {
      return;
    }
    const secondProof = createDeterministicExternalIdentityProof({
      reauth: {
        outcome: "verified_reauthentication",
        proof: {
          issuer: verified.sessionIdentity.issuer,
          subject: verified.sessionIdentity.subject,
          reauthenticatedAt: new Date(Date.now() + 1).toISOString(),
          attemptId: secondAttempt.attemptId,
          tokenId: "logto-jwt-jti-002",
        },
      },
    });
    const secondVerified = await secondProof.verifyHumanReauthentication("reauth");
    expect(secondVerified.ok).toBe(true);
    if (!secondVerified.ok) {
      return;
    }
    await expect(
      identityPrincipals.completeHumanReauthentication({
        proof: secondVerified.proof,
        idempotencyKey: "reauth-complete",
        sessionRef: established.subject.sessionRef,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "idempotency_key_reused" },
    });
  });

  test("claims one re-authentication completion key across concurrent attempts", async () => {
    const verified = await verifiedHuman(
      "human-reauth-idempotency-race",
      "reauth-race@example.test",
    );
    const established = await identityPrincipals.establishHumanSession({
      identity: verified.identity,
      idempotencyKey: "reauth-race-session",
    });
    expect(established.ok).toBe(true);
    if (!established.ok) {
      return;
    }
    const attempts = await Promise.all([
      identityPrincipals.beginHumanReauthentication({
        identity: verified.sessionIdentity,
        idempotencyKey: "reauth-race-begin-a",
        sessionRef: established.subject.sessionRef,
      }),
      identityPrincipals.beginHumanReauthentication({
        identity: verified.sessionIdentity,
        idempotencyKey: "reauth-race-begin-b",
        sessionRef: established.subject.sessionRef,
      }),
    ]);
    expect(attempts.every((attempt) => attempt.ok)).toBe(true);
    const firstAttempt = attempts[0];
    const secondAttempt = attempts[1];
    if (!firstAttempt?.ok || !secondAttempt?.ok) {
      return;
    }
    const reauthenticatedAt = new Date().toISOString();
    const proofs = await Promise.all(
      [firstAttempt, secondAttempt].map((attempt, index) =>
        createDeterministicExternalIdentityProof({
          reauth: {
            outcome: "verified_reauthentication",
            proof: {
              issuer: verified.sessionIdentity.issuer,
              subject: verified.sessionIdentity.subject,
              reauthenticatedAt,
              attemptId: attempt.attemptId,
              tokenId: `logto-jwt-race-${String(index)}`,
            },
          },
        }).verifyHumanReauthentication("reauth"),
      ),
    );
    const firstProof = proofs[0];
    const secondProof = proofs[1];
    if (!firstProof?.ok || !secondProof?.ok) {
      throw new Error("Deterministic re-authentication fixtures must verify");
    }

    const results = await Promise.all(
      [firstProof, secondProof].map(({ proof }) =>
        identityPrincipals.completeHumanReauthentication({
          proof,
          idempotencyKey: "reauth-race-complete",
          sessionRef: established.subject.sessionRef,
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: "idempotency_key_reused" } },
    ]);
  });
});

function humanProof(subject: string, verifiedEmail: string) {
  return createDeterministicExternalIdentityProof({
    firstSignIn: {
      outcome: "verified",
      identity: {
        issuer: "https://identity.example.test/oidc",
        subject,
        authenticatedAt: "2026-08-25T06:00:00.000Z",
        verifiedEmail,
      },
    },
  });
}

async function verifiedHuman(subject: string, verifiedEmail: string) {
  const result = await humanProof(subject, verifiedEmail).verifyHumanSignIn("firstSignIn");
  if (!result.ok) {
    throw new Error("Deterministic human proof fixture must verify");
  }
  return result;
}
